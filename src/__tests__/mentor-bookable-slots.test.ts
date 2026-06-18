/**
 * Unit tests for the shared bookable-slots validator
 * (src/server/mentors/availability.ts → computeBookableSlots).
 *
 * Pure function — no DB. Pins the three subtractions the public booking route,
 * the consultant view, and reschedule all depend on: the min-notice window,
 * buffer padding around bookings, and active slot-locks. Timezone is fixed to
 * UTC so wall-clock → instant math is deterministic.
 */
import { describe, it, expect } from 'vitest';
import { computeBookableSlots } from '@/server/mentors/availability';
import type { MentorRecord, MentorBookingRecord, MentorSlotLockRecord } from '@/server/db/store';

const WEEKLY = Array.from({ length: 7 }, (_, weekday) => ({
  weekday,
  slots: [
    { start: '09:00', end: '10:00' },
    { start: '10:30', end: '11:30' },
  ],
}));

function makeMentor(overrides: Partial<MentorRecord> = {}): MentorRecord {
  return {
    id: 'm-1',
    fullName: 'M',
    position: 'Advisor',
    imageUrl: '',
    bio: null,
    linkedinUrl: null,
    email: null,
    consultationFee: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    weeklyAvailability: WEEKLY,
    blockedDates: [],
    availabilityTimezone: 'UTC',
    minNoticeHours: 0,
    bufferMinutes: 0,
    ...overrides,
  };
}

function makeBooking(overrides: Partial<MentorBookingRecord> = {}): MentorBookingRecord {
  return {
    id: 'b-1',
    mentorId: 'm-1',
    userId: null,
    userName: 'Client',
    userEmail: 'c@example.com',
    userPhone: '0600',
    message: '',
    status: 'CONFIRMED',
    adminNote: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

function lockFor(date: string, startTime: string, durationMinutes: number, expiresAt: string): MentorSlotLockRecord {
  return { bookingId: 'lk', mentorId: 'm-1', date, startTime, durationMinutes, expiresAt, createdAt: '2026-06-01T00:00:00.000Z' };
}

const at = (iso: string) => new Date(iso).getTime();

describe('computeBookableSlots — min-notice window', () => {
  it('hides slots starting before now + minNoticeHours', () => {
    const mentor = makeMentor({ minNoticeHours: 24 });
    const now = at('2026-06-15T08:00:00Z'); // earliest bookable = 2026-06-16T08:00Z
    const slots = computeBookableSlots(mentor, '2026-06-15', '2026-06-17', [], { nowMs: now });

    const d15 = slots.filter((s) => s.date === '2026-06-15');
    const d16 = slots.filter((s) => s.date === '2026-06-16');
    expect(d15.length).toBeGreaterThan(0);
    expect(d15.every((s) => !s.available)).toBe(true); // all before the notice window
    expect(d16.every((s) => s.available)).toBe(true); // 09:00/10:30 are past 08:00 earliest
  });
});

describe('computeBookableSlots — bookings + buffer', () => {
  it('marks an overlapping booking slot unavailable and respects the buffer (half-open)', () => {
    const mentor = makeMentor({ bufferMinutes: 30 });
    const now = at('2026-06-01T00:00:00Z'); // far before, so notice never blocks
    const booking = makeBooking({ consultationDate: '2026-06-15', consultationTime: '09:00', durationMinutes: 60 });
    const slots = computeBookableSlots(mentor, '2026-06-15', '2026-06-15', [booking], { nowMs: now });

    const s0900 = slots.find((s) => s.start === '09:00')!;
    const s1030 = slots.find((s) => s.start === '10:30')!;
    // Booking [9:00,10:00] padded ±30 → [8:30,10:30]; 09:00 slot overlaps.
    expect(s0900.available).toBe(false);
    // 10:30 slot touches the padded end but half-open ⇒ free.
    expect(s1030.available).toBe(true);
  });

  it('ignores REJECTED and CANCELLED bookings', () => {
    const mentor = makeMentor();
    const now = at('2026-06-01T00:00:00Z');
    const cancelled = makeBooking({ status: 'CANCELLED', consultationDate: '2026-06-15', consultationTime: '09:00', durationMinutes: 60 });
    const slots = computeBookableSlots(mentor, '2026-06-15', '2026-06-15', [cancelled], { nowMs: now });
    expect(slots.find((s) => s.start === '09:00')!.available).toBe(true);
  });
});

describe('computeBookableSlots — slot locks', () => {
  it('treats an unexpired lock as occupied and ignores an expired one', () => {
    const mentor = makeMentor();
    const now = at('2026-06-01T00:00:00Z');

    const liveLock = lockFor('2026-06-15', '09:00', 60, '2026-06-01T00:10:00Z'); // expires after `now`
    const lockedSlots = computeBookableSlots(mentor, '2026-06-15', '2026-06-15', [], { nowMs: now, slotLocks: [liveLock] });
    expect(lockedSlots.find((s) => s.start === '09:00')!.available).toBe(false);

    const deadLock = lockFor('2026-06-15', '09:00', 60, '2026-05-31T23:00:00Z'); // already expired
    const freeSlots = computeBookableSlots(mentor, '2026-06-15', '2026-06-15', [], { nowMs: now, slotLocks: [deadLock] });
    expect(freeSlots.find((s) => s.start === '09:00')!.available).toBe(true);
  });
});

describe('computeBookableSlots — blocked dates & defaults', () => {
  it('returns all slots unavailable on a blocked date', () => {
    const mentor = makeMentor({ blockedDates: ['2026-06-15'] });
    const now = at('2026-06-01T00:00:00Z');
    const slots = computeBookableSlots(mentor, '2026-06-15', '2026-06-15', [], { nowMs: now });
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.every((s) => !s.available)).toBe(true);
  });

  it('applies the 24h default notice when minNoticeHours is unset', () => {
    const mentor = makeMentor({ minNoticeHours: undefined });
    const now = at('2026-06-15T08:00:00Z');
    const slots = computeBookableSlots(mentor, '2026-06-15', '2026-06-15', [], { nowMs: now });
    expect(slots.every((s) => !s.available)).toBe(true); // same-day blocked by default notice
  });
});
