/**
 * Unit tests for the slot-lock helpers (src/server/mentors/slot-lock.ts).
 *
 * Pins the concurrency guarantee taken at payment INITIATION: a second booking
 * can't hold an overlapping slot, the same booking can refresh idempotently,
 * release is idempotent, and expired locks free the slot.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { db, type MentorBookingRecord } from '@/server/db/store';
import { lockSlot, releaseSlot, isSlotLocked } from '@/server/mentors/slot-lock';

beforeEach(async () => {
  // lockSlot now also reads mentorBookings, so clear both for isolation.
  await db.update((d) => { d.mentorSlotLocks = []; d.mentorBookings = []; });
});

/** Seed one mentor booking (defaults: a seat-holding READY 09:00–10:00). */
function seedBooking(over: Partial<MentorBookingRecord> = {}): Promise<unknown> {
  return db.update((d) => {
    d.mentorBookings = [
      ...(d.mentorBookings ?? []),
      {
        id: 'existing', mentorId: 'm1', userId: null, userName: 'C', userEmail: 'c@x.io',
        userPhone: '0', message: '', status: 'READY', adminNote: null,
        consultationDate: '2026-06-15', consultationTime: '09:00', durationMinutes: 60,
        createdAt: '', updatedAt: '', ...over,
      } as MentorBookingRecord,
    ];
  });
}

describe('lockSlot', () => {
  it('locks a free slot and reports it locked', async () => {
    const res = await lockSlot({ bookingId: 'b1', mentorId: 'm1', date: '2026-06-15', startTime: '09:00', durationMinutes: 60 });
    expect(res.ok).toBe(true);
    expect(await isSlotLocked('m1', '2026-06-15', '09:00', 60)).toBe(true);
  });

  it('rejects a different booking overlapping an active lock', async () => {
    await lockSlot({ bookingId: 'b1', mentorId: 'm1', date: '2026-06-15', startTime: '09:00', durationMinutes: 60 });
    const clash = await lockSlot({ bookingId: 'b2', mentorId: 'm1', date: '2026-06-15', startTime: '09:30', durationMinutes: 60 });
    expect(clash.ok).toBe(false);
    if (!clash.ok) expect(clash.reason).toBe('SLOT_TAKEN');
  });

  it('allows a non-overlapping slot for the same mentor/date', async () => {
    await lockSlot({ bookingId: 'b1', mentorId: 'm1', date: '2026-06-15', startTime: '09:00', durationMinutes: 60 });
    const other = await lockSlot({ bookingId: 'b2', mentorId: 'm1', date: '2026-06-15', startTime: '10:00', durationMinutes: 60 });
    expect(other.ok).toBe(true);
  });

  it('is idempotent for the same bookingId (refreshes, no conflict)', async () => {
    const first = await lockSlot({ bookingId: 'b1', mentorId: 'm1', date: '2026-06-15', startTime: '09:00', durationMinutes: 60 });
    const again = await lockSlot({ bookingId: 'b1', mentorId: 'm1', date: '2026-06-15', startTime: '09:00', durationMinutes: 60 });
    expect(first.ok && again.ok).toBe(true);
    const data = await db.read();
    expect(data.mentorSlotLocks.filter((l) => l.bookingId === 'b1')).toHaveLength(1);
  });

  it('rejects an invalid time', async () => {
    const res = await lockSlot({ bookingId: 'b1', mentorId: 'm1', date: '2026-06-15', startTime: '99:99', durationMinutes: 60 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('INVALID');
  });
});

describe('releaseSlot & expiry', () => {
  it('release frees the slot and is idempotent', async () => {
    await lockSlot({ bookingId: 'b1', mentorId: 'm1', date: '2026-06-15', startTime: '09:00', durationMinutes: 60 });
    await releaseSlot('b1');
    expect(await isSlotLocked('m1', '2026-06-15', '09:00', 60)).toBe(false);
    await releaseSlot('b1'); // no throw on repeat
    const next = await lockSlot({ bookingId: 'b2', mentorId: 'm1', date: '2026-06-15', startTime: '09:00', durationMinutes: 60 });
    expect(next.ok).toBe(true);
  });

  it('an expired lock no longer blocks a new lock', async () => {
    await lockSlot({ bookingId: 'b1', mentorId: 'm1', date: '2026-06-15', startTime: '09:00', durationMinutes: 60 });
    await db.update((d) => {
      d.mentorSlotLocks[0]!.expiresAt = new Date(Date.now() - 1000).toISOString();
    });
    const fresh = await lockSlot({ bookingId: 'b2', mentorId: 'm1', date: '2026-06-15', startTime: '09:00', durationMinutes: 60 });
    expect(fresh.ok).toBe(true);
    // The expired one was swept.
    const data = await db.read();
    expect(data.mentorSlotLocks.filter((l) => l.bookingId === 'b1')).toHaveLength(0);
  });
});

describe('lockSlot — booking-aware conflict (atomic reservation)', () => {
  it('rejects a lock overlapping a seat-holding booking', async () => {
    await seedBooking({ status: 'READY' });
    const res = await lockSlot({ bookingId: 'new', mentorId: 'm1', date: '2026-06-15', startTime: '09:00', durationMinutes: 60 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('SLOT_TAKEN');
  });

  it('rejects a partially-overlapping longer session against a booking', async () => {
    await seedBooking({ status: 'CONFIRMED', consultationTime: '10:00' }); // 10:00–11:00
    // A 90-min hold at 09:00 runs 09:00–10:30 → overlaps 10:00–11:00.
    const res = await lockSlot({ bookingId: 'new', mentorId: 'm1', date: '2026-06-15', startTime: '09:00', durationMinutes: 90 });
    expect(res.ok).toBe(false);
  });

  it('ignores a PENDING_PAYMENT / CANCELLED booking (no seat held)', async () => {
    await seedBooking({ status: 'PENDING_PAYMENT' });
    const a = await lockSlot({ bookingId: 'new', mentorId: 'm1', date: '2026-06-15', startTime: '09:00', durationMinutes: 60 });
    expect(a.ok).toBe(true);

    await db.update((d) => { d.mentorSlotLocks = []; d.mentorBookings = []; });
    await seedBooking({ status: 'CANCELLED' });
    const b = await lockSlot({ bookingId: 'new2', mentorId: 'm1', date: '2026-06-15', startTime: '09:00', durationMinutes: 60 });
    expect(b.ok).toBe(true);
  });

  it("does not treat the lock's own booking as a conflict (idempotent settle path)", async () => {
    await seedBooking({ id: 'self', status: 'PENDING_PAYMENT' });
    const res = await lockSlot({ bookingId: 'self', mentorId: 'm1', date: '2026-06-15', startTime: '09:00', durationMinutes: 60 });
    expect(res.ok).toBe(true);
  });
});
