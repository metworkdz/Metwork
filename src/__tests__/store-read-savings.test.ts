/**
 * The store's data allowance: the whole document is downloaded only when it
 * changed, a mutator that changes nothing writes nothing, and the 15-minute
 * crons look at the few lists they need first — without any instance missing
 * another's write.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db, type MentorBookingRecord } from '@/server/db/store';
import { mockWriteCount, takeMockReads, writeMockBlobAsAnotherInstance, writeMockBlobWithoutRevision } from './setup';
import { reconcilePendingTopUps } from '@/server/wallet/service';
import { reconcilePendingCardBookings } from '@/server/bookings/card-payment';
import { reconcilePendingDirectConsultations } from '@/server/consultations/direct-payment';
import { reconcilePendingPaymentLinks } from '@/server/payments/payment-links';
import { sendConsultationRemindersDue } from '@/server/notifications/consultation-reminder';
import { sweepExpiredTokens } from '@/server/auth/sweep-expired';

let clock = 0;
const NOW = Date.parse('2026-11-06T12:00:00.000Z');
const tick = (ms: number) => { clock += ms; };

beforeEach(async () => {
  clock = NOW;
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  await db.update((d) => { d.users = []; });
  takeMockReads();
});
afterEach(() => vi.restoreAllMocks());

const REV = 'rev:data->>_rev';

describe('when the 10-second copy expires', () => {
  it('asks only for the revision while nothing has changed', async () => {
    await db.read();
    expect(takeMockReads()).toEqual([]); // still fresh
    tick(11_000);
    await db.read();
    tick(11_000);
    await db.read();
    expect(takeMockReads()).toEqual([REV, REV]);
  });

  it('downloads the document when another instance wrote', async () => {
    await db.read();
    writeMockBlobAsAnotherInstance((b) => { b.users = [{ id: 'other' }]; });
    tick(11_000);
    const d = await db.read();
    expect(takeMockReads()).toEqual([REV, 'data']);
    expect(d.users).toEqual([{ id: 'other' }]);
  });

  it('a change that did not move the revision still shows within 15 minutes', async () => {
    await db.read();
    writeMockBlobWithoutRevision((b) => { b.users = [{ id: 'sql-edit' }]; });
    tick(11_000);
    expect((await db.read()).users).toEqual([]);
    tick(15 * 60_000);
    expect((await db.read()).users).toEqual([{ id: 'sql-edit' }]);
  });

  it('own writes do not cause a download, and a write on a stale copy still retries', async () => {
    await db.update((d) => { d.users = [{ id: 'mine' } as never]; });
    takeMockReads();
    tick(11_000);
    await db.read();
    expect(takeMockReads()).toEqual([REV]);

    writeMockBlobAsAnotherInstance((b) => { b.users = [{ id: 'theirs' }]; });
    await db.update((d) => { d.users.push({ id: 'mine-2' } as never); });
    expect((await db.read()).users.map((u) => u.id)).toEqual(['theirs', 'mine-2']);
  });
});

describe('a mutator that changes nothing', () => {
  it('writes nothing and keeps the revision, and returns its result', async () => {
    const writes = mockWriteCount();
    const rev = (await db.read())._rev;
    expect(await db.update(() => 'nothing to do')).toBe('nothing to do');
    expect(mockWriteCount()).toBe(writes);
    expect((await db.read())._rev).toBe(rev);
    await db.update((d) => { d.users = [{ id: 'real' } as never]; });
    expect(mockWriteCount()).toBe(writes + 1);
    expect((await db.read())._rev).toBe((rev ?? 0) + 1);
  });
});

describe('a decision that changes nothing, made on a stale copy', () => {
  it('runs again on current data and answers from it', async () => {
    await db.update((d) => { d.users = []; });
    await db.read();
    writeMockBlobAsAnotherInstance((b) => { b.users = [{ id: 'topped-up' }]; });
    const runs: number[] = [];
    const seen = await db.update((d) => { runs.push(d.users.length); return d.users.length; });
    expect(runs).toEqual([0, 1]);
    expect(seen).toBe(1);
  });
});

describe('peek', () => {
  it('reads only the named lists, fresh from the row', async () => {
    writeMockBlobAsAnotherInstance((b) => { b.paymentLinks = [{ id: 'pl' }]; });
    tick(11_000);
    const p = await db.peek(['paymentLinks', 'topUpIntents']);
    expect(takeMockReads()).toEqual(['paymentLinks:data->paymentLinks,topUpIntents:data->topUpIntents']);
    expect(p.paymentLinks).toEqual([{ id: 'pl' }]);
    expect(p.topUpIntents).toEqual([]);
  });
});

describe('the 15-minute crons', () => {
  const start = () => new Date(clock + 30 * 60_000).toISOString();
  const booking = (extra: Partial<MentorBookingRecord>) => ({ id: 'b1', mentorId: 'nobody', instantBook: true, status: 'READY', scheduledAt: start(), userEmail: 'c@x.dz', ...extra }) as MentorBookingRecord;

  it('with nothing to do: no document download and no write', async () => {
    const writes = mockWriteCount();
    tick(11_000);
    await reconcilePendingTopUps();
    await reconcilePendingCardBookings();
    await reconcilePendingDirectConsultations();
    await reconcilePendingPaymentLinks();
    expect(await sendConsultationRemindersDue(new Date(clock))).toEqual({ sent: 0, clientSent: 0, skippedNoMentor: 0 });
    expect(takeMockReads()).not.toContain('data');
    expect(mockWriteCount()).toBe(writes);
  });

  it('a due reminder is still claimed, once', async () => {
    await db.update((d) => { d.mentorBookings = [booking({})]; });
    tick(11_000);
    await sendConsultationRemindersDue(new Date(clock));
    const b = (await db.read()).mentorBookings![0]!;
    expect(b.consultantReminderSentAt).toBeTruthy();
    expect(b.clientReminderSentAt).toBeTruthy();
    takeMockReads();
    const writes = mockWriteCount();
    tick(11_000);
    await sendConsultationRemindersDue(new Date(clock));
    expect(mockWriteCount()).toBe(writes);
  });

  it('a pending payment is still found by the reconcilers', async () => {
    const old = new Date(clock - 3600_000).toISOString();
    await db.update((d) => {
      d.paymentLinks = [{ id: 'pl', slug: 'x', status: 'ACTIVE', providerRef: 'r', updatedAt: old } as never];
      d.topUpIntents = [{ id: 't', status: 'PENDING', providerRef: 'r', createdAt: old } as never];
    });
    tick(11_000);
    expect((await reconcilePendingPaymentLinks()).checked).toBe(1);
    expect(await reconcilePendingTopUps()).toMatchObject({ checked: 1 });
  });
});

describe('the daily token sweep', () => {
  const past = (h: number) => new Date(NOW - h * 3600_000).toISOString();
  it('removes what expired over a day ago, keeps the rest, and does not write twice', async () => {
    const future = new Date(NOW + 3600_000).toISOString();
    await db.update((d) => {
      d.sessions = [{ idHash: 'old', expiresAt: past(48) }, { idHash: 'recent', expiresAt: past(2) }, { idHash: 'live', expiresAt: future }] as never;
      d.otps = [{ id: 'old', expiresAt: past(48) }] as never;
      d.mentorSessions = [{ idHash: 'old', expiresAt: past(48) }, { idHash: 'live', expiresAt: future }] as never;
    });
    expect(await sweepExpiredTokens(new Date(NOW))).toMatchObject({ sessions: 1, otps: 1, mentorSessions: 1 });
    const d = await db.read();
    expect(d.sessions.map((s) => s.idHash)).toEqual(['recent', 'live']);
    expect(d.otps).toEqual([]);
    expect(d.mentorSessions!.map((s) => s.idHash)).toEqual(['live']);
    const writes = mockWriteCount();
    await sweepExpiredTokens(new Date(NOW));
    expect(mockWriteCount()).toBe(writes);
  });
});
