/**
 * Unit tests for the canonical hour-aligned slot generator
 * (src/server/mentors/availability.ts → computeHourlySlots) and the mentor
 * seat-hold predicate. Pure functions — no DB. Timezone fixed to UTC so
 * wall-clock → instant math is deterministic.
 *
 * Pins the rules the public availability API + booking gate + reschedule share:
 *   • starts are WHOLE HOURS only (09:00, 10:00 …) — never :30/:45;
 *   • a session that would run past the window end is shown greyed, not omitted;
 *   • overlap with a seat-holding booking, min-notice, and blocked dates all
 *     disable a slot;
 *   • unpaid intents (PENDING_PAYMENT / AWAITING_PAYMENT) hold NO seat.
 */
import { describe, it, expect } from 'vitest';
import { computeHourlySlots, mentorBookingHoldsSeat } from '@/server/mentors/availability';
import type { MentorRecord, MentorBookingRecord } from '@/server/db/store';

/** All weekdays open 09:00–12:00. */
const WEEKLY = Array.from({ length: 7 }, (_, weekday) => ({
  weekday,
  slots: [{ start: '09:00', end: '12:00' }],
}));

function makeMentor(overrides: Partial<MentorRecord> = {}): MentorRecord {
  return {
    id: 'm-1', fullName: 'M', position: 'Advisor', imageUrl: '',
    bio: null, linkedinUrl: null, email: null, consultationFee: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    weeklyAvailability: WEEKLY, blockedDates: [], availabilityTimezone: 'UTC',
    minNoticeHours: 0, bufferMinutes: 0,
    ...overrides,
  };
}

function makeBooking(overrides: Partial<MentorBookingRecord> = {}): MentorBookingRecord {
  return {
    id: 'b-1', mentorId: 'm-1', userId: null, userName: 'C', userEmail: 'c@x.io',
    userPhone: '0600', message: '', status: 'CONFIRMED', adminNote: null,
    createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

const DATE = '2026-06-15';
const NOW = new Date('2026-06-01T00:00:00Z').getTime(); // far before → notice never blocks

describe('computeHourlySlots — hour alignment', () => {
  it('emits only whole-hour starts within the window', () => {
    const slots = computeHourlySlots(makeMentor(), DATE, 60, [], { nowMs: NOW });
    expect(slots.map((s) => s.start)).toEqual(['09:00', '10:00', '11:00']);
    expect(slots.every((s) => /^\d{2}:00$/.test(s.start))).toBe(true);
  });

  it('never emits a non-hour start even when the window starts on the half-hour', () => {
    const mentor = makeMentor({ weeklyAvailability: WEEKLY.map((d) => ({ ...d, slots: [{ start: '09:30', end: '12:00' }] })) });
    const slots = computeHourlySlots(mentor, DATE, 60, [], { nowMs: NOW });
    expect(slots.map((s) => s.start)).toEqual(['10:00', '11:00']);
  });
});

describe('computeHourlySlots — duration fits the window (greying, not omission)', () => {
  it('60-min: every hour up to the window end is available', () => {
    const slots = computeHourlySlots(makeMentor(), DATE, 60, [], { nowMs: NOW });
    expect(slots.find((s) => s.start === '11:00')).toMatchObject({ end: '12:00', available: true });
  });

  it('90-min: 11:00 is shown but greyed (would end 12:30, past 12:00)', () => {
    const slots = computeHourlySlots(makeMentor(), DATE, 90, [], { nowMs: NOW });
    // Still present in the list…
    const s1100 = slots.find((s) => s.start === '11:00')!;
    expect(s1100).toBeDefined();
    expect(s1100).toMatchObject({ end: '12:30', available: false });
    // …while the earlier ones that fit are available.
    expect(slots.find((s) => s.start === '09:00')!.available).toBe(true);
    expect(slots.find((s) => s.start === '10:00')!.available).toBe(true);
  });
});

describe('computeHourlySlots — conflicts, notice, blocked', () => {
  it('marks slots overlapping a seat-holding booking unavailable', () => {
    const booking = makeBooking({ consultationDate: DATE, consultationTime: '10:00', durationMinutes: 60 });
    const slots = computeHourlySlots(makeMentor(), DATE, 60, [booking], { nowMs: NOW });
    expect(slots.find((s) => s.start === '10:00')!.available).toBe(false);
    expect(slots.find((s) => s.start === '09:00')!.available).toBe(true); // 09–10 doesn't overlap 10–11
    expect(slots.find((s) => s.start === '11:00')!.available).toBe(true);
  });

  it('a PENDING_PAYMENT / AWAITING_PAYMENT intent holds NO seat', () => {
    for (const status of ['PENDING_PAYMENT', 'AWAITING_PAYMENT'] as const) {
      const intent = makeBooking({ status, consultationDate: DATE, consultationTime: '10:00', durationMinutes: 60 });
      const slots = computeHourlySlots(makeMentor(), DATE, 60, [intent], { nowMs: NOW });
      expect(slots.find((s) => s.start === '10:00')!.available).toBe(true);
    }
  });

  it('hides slots inside the min-notice window', () => {
    const mentor = makeMentor({ minNoticeHours: 24 });
    // now = 09:00Z on the same day → earliest bookable = next day; all same-day greyed.
    const now = new Date(`${DATE}T09:00:00Z`).getTime();
    const slots = computeHourlySlots(mentor, DATE, 60, [], { nowMs: now });
    expect(slots.every((s) => !s.available)).toBe(true);
  });

  it('returns all slots unavailable on a blocked date (still listed)', () => {
    const mentor = makeMentor({ blockedDates: [DATE] });
    const slots = computeHourlySlots(mentor, DATE, 60, [], { nowMs: NOW });
    expect(slots.length).toBe(3);
    expect(slots.every((s) => !s.available)).toBe(true);
  });

  it('returns [] when the weekday has no template', () => {
    const mentor = makeMentor({ weeklyAvailability: [{ weekday: 0, slots: [{ start: '09:00', end: '12:00' }] }] });
    // 2026-06-16 is a Tuesday (weekday 2) — no template.
    expect(computeHourlySlots(mentor, '2026-06-16', 60, [], { nowMs: NOW })).toEqual([]);
  });
});

describe('mentorBookingHoldsSeat', () => {
  it('holds a seat for active/confirmed states, not for rejected/cancelled/unpaid intents', () => {
    for (const s of ['PENDING', 'APPROVED', 'CONFIRMED', 'AWAITING_LINK', 'READY', 'COMPLETED'] as const) {
      expect(mentorBookingHoldsSeat(s)).toBe(true);
    }
    for (const s of ['REJECTED', 'CANCELLED', 'PENDING_PAYMENT', 'AWAITING_PAYMENT'] as const) {
      expect(mentorBookingHoldsSeat(s)).toBe(false);
    }
  });
});
