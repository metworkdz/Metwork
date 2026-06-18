/**
 * PROMPT 4 — consultant self-service profile/availability/earnings endpoints.
 *
 * Exercises the new thin, requireConsultant-guarded routes end-to-end against
 * the in-memory DB with a mocked cookie jar (same pattern as the access tests):
 *   • PATCH /api/consultant/availability — weekly template + notice/buffer
 *   • PATCH /api/consultant/profile       — bio/topics/rates/free-intro
 *   • GET   /api/consultant/earnings      — the display-only summary
 * plus the validation rules and the money-safety invariant (the live per-hour
 * consultationFee is never editable from the portal).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { jar } = vi.hoisted(() => ({ jar: new Map<string, string>() }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (n: string) => (jar.has(n) ? { value: jar.get(n) } : undefined),
    set: (n: string, v: string) => { jar.set(n, v); },
  }),
}));

import { db, type MentorRecord, type MentorLedgerTxnRecord } from '@/server/db/store';
import { createMentorSession, setMentorSessionCookie } from '@/server/mentors/access';
import { PATCH as patchAvailability } from '@/app/api/consultant/availability/route';
import { PATCH as patchProfile } from '@/app/api/consultant/profile/route';
import { GET as getEarnings } from '@/app/api/consultant/earnings/route';

const MENTOR: MentorRecord = {
  id: 'm-1', fullName: 'Sara Consultant', position: 'Growth Advisor', imageUrl: '',
  bio: null, linkedinUrl: null, email: 's@example.com', consultationFee: 8000,
  createdAt: '2026-01-01T00:00:00.000Z',
};

function jsonReq(body: unknown): Request {
  return new Request('http://localhost/api/consultant', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function signIn(mentorId: string): Promise<void> {
  const session = await createMentorSession(mentorId);
  await setMentorSessionCookie(session);
}

beforeEach(async () => {
  jar.clear();
  await db.update((d) => {
    d.mentors = [{ ...MENTOR }];
    d.mentorBookings = [];
    d.mentorLedgerTxns = [];
    d.mentorSessions = [];
    d.mentorWallets = [];
  });
});

describe('PATCH /api/consultant/availability', () => {
  it('rejects an unauthenticated request', async () => {
    const res = await patchAvailability(jsonReq({ weeklyAvailability: [], blockedDates: [] }) as never);
    expect(res.status).toBe(401);
  });

  it('saves the weekly template + notice/buffer for the signed-in consultant', async () => {
    await signIn('m-1');
    const res = await patchAvailability(jsonReq({
      weeklyAvailability: [{ weekday: 1, slots: [{ start: '09:00', end: '12:00' }] }],
      blockedDates: ['2026-07-01'],
      availabilityTimezone: 'Africa/Algiers',
      minNoticeHours: 48,
      bufferMinutes: 15,
    }) as never);
    expect(res.status).toBe(200);

    const data = await db.read();
    const m = data.mentors.find((x) => x.id === 'm-1')!;
    expect(m.weeklyAvailability).toEqual([{ weekday: 1, slots: [{ start: '09:00', end: '12:00' }] }]);
    expect(m.blockedDates).toEqual(['2026-07-01']);
    expect(m.minNoticeHours).toBe(48);
    expect(m.bufferMinutes).toBe(15);
  });

  it('rejects overlapping ranges (422)', async () => {
    await signIn('m-1');
    const res = await patchAvailability(jsonReq({
      weeklyAvailability: [{ weekday: 2, slots: [{ start: '09:00', end: '12:00' }, { start: '11:00', end: '13:00' }] }],
      blockedDates: [],
    }) as never);
    expect(res.status).toBe(422);
  });
});

describe('PATCH /api/consultant/profile', () => {
  it('saves bio/topics/rates/free-intro and leaves the live fee untouched', async () => {
    await signIn('m-1');
    const res = await patchProfile(jsonReq({
      bio: '  Helping founders scale.  ',
      topics: ['Fundraising', 'fundraising', 'GTM'],
      ratePer30: 3000,
      ratePer60: 5500,
      freeIntroEnabled: true,
    }) as never);
    expect(res.status).toBe(200);

    const m = (await db.read()).mentors.find((x) => x.id === 'm-1')!;
    expect(m.bio).toBe('Helping founders scale.');
    expect(m.topics).toEqual(['Fundraising', 'GTM']); // trimmed + de-duped
    expect(m.ratePer30).toBe(3000);
    expect(m.ratePer60).toBe(5500);
    expect(m.freeIntroEnabled).toBe(true);
    // Money-safety: the per-hour charged fee is never editable here.
    expect(m.consultationFee).toBe(8000);
  });

  it('ignores an attempt to set consultationFee (not in the schema)', async () => {
    await signIn('m-1');
    await patchProfile(jsonReq({ consultationFee: 99999, bio: 'x' }) as never);
    const m = (await db.read()).mentors.find((x) => x.id === 'm-1')!;
    expect(m.consultationFee).toBe(8000);
  });
});

describe('GET /api/consultant/earnings — summary', () => {
  it('aggregates consultations/gross/net/commission from bookings + ledger', async () => {
    await signIn('m-1');
    const now = '2026-06-01T00:00:00.000Z';
    const txn = (over: Partial<MentorLedgerTxnRecord>): MentorLedgerTxnRecord => ({
      id: `t-${Math.random()}`, mentorId: 'm-1', bookingId: 'b', type: 'EARNING',
      amount: 0, bucket: 'PENDING', status: 'COMPLETED', reference: `r-${Math.random()}`,
      description: '', metadata: {}, createdAt: now, completedAt: now, ...over,
    });
    await db.update((d) => {
      d.mentorBookings = [
        { id: 'b1', mentorId: 'm-1', userId: null, userName: 'A', userEmail: 'a@x.io', userPhone: '1', message: '', status: 'READY', adminNote: null, amountCharged: 4000, createdAt: now, updatedAt: now },
        { id: 'b2', mentorId: 'm-1', userId: null, userName: 'B', userEmail: 'b@x.io', userPhone: '2', message: '', status: 'COMPLETED', adminNote: null, amountCharged: 6000, createdAt: now, updatedAt: now },
        { id: 'b3', mentorId: 'm-1', userId: null, userName: 'C', userEmail: 'c@x.io', userPhone: '3', message: '', status: 'CANCELLED', adminNote: null, amountCharged: 5000, createdAt: now, updatedAt: now },
      ] as never;
      d.mentorLedgerTxns = [
        txn({ type: 'EARNING', amount: 2800 }),
        txn({ type: 'EARNING', amount: 4200 }),
        txn({ type: 'REVERSAL', amount: -1000 }),
        txn({ type: 'COMMISSION', amount: -1200 }),
        txn({ type: 'PAYOUT', amount: -500, bucket: 'AVAILABLE' }),
      ];
    });

    const res = await getEarnings();
    expect(res.status).toBe(200);
    const body = await res.json() as { summary: { consultations: number; gross: number; net: number; commission: number } };
    expect(body.summary.consultations).toBe(2);      // READY + COMPLETED, not CANCELLED
    expect(body.summary.gross).toBe(10000);          // 4000 + 6000
    expect(body.summary.net).toBe(6000);             // 2800 + 4200 − 1000
    expect(body.summary.commission).toBe(4000);      // gross − net
  });
});
