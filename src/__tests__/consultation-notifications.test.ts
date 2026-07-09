/**
 * Tests for the consultation notification chain added for the "client hears
 * nothing" fixes:
 *   • sendConsultationReceivedOnce — the client "request received" ack (fires
 *     only when a booking is NOT READY; deduped via requestReceivedEmailSentAt).
 *   • setBookingMeetingLink re-notify — changing meeting details on an
 *     already-notified booking clears `linkSentAt` so the client gets the
 *     corrected details; re-saving identical details never re-sends.
 *   • sendConsultationRemindersDue — the consultant pre-session reminder cron
 *     service (24h window, atomic one-shot claim, schedule resolution).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { db, type MentorBookingRecord, type MentorRecord } from '@/server/db/store';
import { sendConsultationReceivedOnce } from '@/server/notifications/consultation-received';
import {
  sendConsultationRemindersDue,
  bookingStartMs,
  REMINDER_WINDOW_HOURS,
} from '@/server/notifications/consultation-reminder';
import { setBookingMeetingLink } from '@/server/consultations/lifecycle';
import { listPublicMentors } from '@/server/mentors/service';
import { setMentorPublished } from '@/server/mentors/approval';

const MENTOR: MentorRecord = {
  id: 'm-notif-1',
  fullName: 'Notif Mentor',
  position: 'Advisor',
  imageUrl: '',
  bio: null,
  linkedinUrl: null,
  email: 'mentor@example.com',
  consultationFee: 10_000,
  createdAt: '2026-01-01T00:00:00.000Z',
};

function makeBooking(overrides: Partial<MentorBookingRecord>): MentorBookingRecord {
  return {
    id: overrides.id ?? 'b-notif-1',
    mentorId: MENTOR.id,
    userId: null,
    userName: 'Client One',
    userEmail: 'client@example.com',
    userPhone: '+213555000111',
    message: 'Need advice on my startup plan.',
    status: 'AWAITING_LINK',
    adminNote: null,
    instantBook: true,
    paymentStatus: 'PAID',
    durationMinutes: 60,
    guestLocale: 'fr',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

async function seed(bookings: MentorBookingRecord[]): Promise<void> {
  await db.update((d) => {
    d.mentors = [{ ...MENTOR }];
    d.mentorBookings = bookings;
  });
}

async function getBooking(id: string): Promise<MentorBookingRecord> {
  const data = await db.read();
  const b = (data.mentorBookings ?? []).find((x) => x.id === id);
  if (!b) throw new Error(`booking ${id} not found`);
  return b;
}

/** Let the fire-and-forget async sends settle. */
const flush = () => new Promise((r) => setTimeout(r, 20));

beforeEach(async () => {
  await seed([]);
});

describe('sendConsultationReceivedOnce', () => {
  it('claims the ack for a non-READY booking exactly once', async () => {
    await seed([makeBooking({ id: 'b1', status: 'AWAITING_LINK' })]);
    await sendConsultationReceivedOnce('b1');
    const first = (await getBooking('b1')).requestReceivedEmailSentAt;
    expect(first).toBeTruthy();

    await sendConsultationReceivedOnce('b1');
    expect((await getBooking('b1')).requestReceivedEmailSentAt).toBe(first);
  });

  it('does nothing for a READY booking (session-ready email is the ack)', async () => {
    await seed([makeBooking({ id: 'b2', status: 'READY', meetingMode: 'ONLINE', meetingLink: 'https://meet.example/x' })]);
    await sendConsultationReceivedOnce('b2');
    expect((await getBooking('b2')).requestReceivedEmailSentAt).toBeUndefined();
  });

  it('acks a guest PENDING_PAYMENT booking at creation', async () => {
    await seed([makeBooking({ id: 'b3', status: 'PENDING_PAYMENT', paymentStatus: 'AWAITING_PAYMENT', source: 'guest' })]);
    await sendConsultationReceivedOnce('b3');
    expect((await getBooking('b3')).requestReceivedEmailSentAt).toBeTruthy();
  });
});

describe('setBookingMeetingLink re-notify on changed details', () => {
  it('clears linkSentAt (and re-claims) when the link changes', async () => {
    const oldStamp = '2026-01-02T00:00:00.000Z';
    await seed([makeBooking({
      id: 'b4', status: 'READY', meetingMode: 'ONLINE',
      meetingLink: 'https://meet.example/old', linkSentAt: oldStamp,
    })]);

    const res = await setBookingMeetingLink({ bookingId: 'b4', mode: 'ONLINE', link: 'https://meet.example/new' });
    expect(res.ok).toBe(true);
    await flush();

    const after = await getBooking('b4');
    expect(after.meetingLink).toBe('https://meet.example/new');
    // The stamp was cleared and re-claimed by the (re-)send — never the old one.
    expect(after.linkSentAt).toBeTruthy();
    expect(after.linkSentAt).not.toBe(oldStamp);
  });

  it('keeps the stamp (no re-send) when identical details are re-saved', async () => {
    const stamp = '2026-01-02T00:00:00.000Z';
    await seed([makeBooking({
      id: 'b5', status: 'READY', meetingMode: 'ONLINE',
      meetingLink: 'https://meet.example/same', linkSentAt: stamp,
    })]);

    const res = await setBookingMeetingLink({ bookingId: 'b5', mode: 'ONLINE', link: 'https://meet.example/same' });
    expect(res.ok).toBe(true);
    await flush();

    expect((await getBooking('b5')).linkSentAt).toBe(stamp);
  });
});

describe('sendConsultationRemindersDue', () => {
  const NOW = new Date('2026-03-10T10:00:00.000Z');
  const inHours = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();

  it('claims exactly the due bookings, once', async () => {
    await seed([
      // Due: READY, starts in 2h.
      makeBooking({ id: 'r1', status: 'READY', meetingMode: 'ONLINE', meetingLink: 'https://meet.example/r1', scheduledAt: inHours(2) }),
      // Due: AWAITING_LINK (the "add your link" nudge), starts in 12h.
      makeBooking({ id: 'r2', status: 'AWAITING_LINK', scheduledAt: inHours(12) }),
      // Not due: beyond the 24h window.
      makeBooking({ id: 'r3', status: 'READY', scheduledAt: inHours(REMINDER_WINDOW_HOURS + 6) }),
      // Not due: already started.
      makeBooking({ id: 'r4', status: 'READY', scheduledAt: inHours(-1) }),
      // Not due: completed.
      makeBooking({ id: 'r5', status: 'COMPLETED', scheduledAt: inHours(2) }),
      // Not due: already reminded.
      makeBooking({ id: 'r6', status: 'READY', scheduledAt: inHours(2), consultantReminderSentAt: '2026-03-09T00:00:00.000Z' }),
      // Not due: no schedule at all.
      makeBooking({ id: 'r7', status: 'AWAITING_LINK', scheduledAt: null }),
      // Not due: legacy (non-instant-book) booking.
      makeBooking({ id: 'r8', status: 'READY', scheduledAt: inHours(2), instantBook: undefined }),
      // Due: date+time only (no scheduledAt) — 13:00 Algiers = 12:00 UTC (+2h).
      makeBooking({ id: 'r9', status: 'READY', scheduledAt: null, consultationDate: '2026-03-10', consultationTime: '13:00' }),
    ]);

    const run1 = await sendConsultationRemindersDue(NOW);
    expect(run1.sent).toBe(3);
    expect(run1.skippedNoMentor).toBe(0);
    // None of the fixtures start within 1h → no client reminders yet.
    expect(run1.clientSent).toBe(0);

    for (const id of ['r1', 'r2', 'r9']) {
      expect((await getBooking(id)).consultantReminderSentAt).toBeTruthy();
    }
    for (const id of ['r3', 'r4', 'r5', 'r7', 'r8']) {
      expect((await getBooking(id)).consultantReminderSentAt).toBeFalsy();
    }

    // Idempotent: a second run claims nothing.
    const run2 = await sendConsultationRemindersDue(NOW);
    expect(run2.sent).toBe(0);
    expect(run2.clientSent).toBe(0);
  });

  it('sends the client 1h reminder only for READY bookings inside the 1h window', async () => {
    await seed([
      // Due for the CLIENT (and the consultant 24h pass): READY, starts in 30 min.
      makeBooking({ id: 'c1', status: 'READY', meetingMode: 'ONLINE', meetingLink: 'https://meet.example/c1', scheduledAt: inHours(0.5) }),
      // NOT due for the client (no meeting details) — consultant still nudged.
      makeBooking({ id: 'c2', status: 'AWAITING_LINK', scheduledAt: inHours(0.5) }),
      // NOT due for the client yet (outside the 1h window).
      makeBooking({ id: 'c3', status: 'READY', meetingMode: 'ONLINE', meetingLink: 'https://meet.example/c3', scheduledAt: inHours(3) }),
    ]);

    const run1 = await sendConsultationRemindersDue(NOW);
    expect(run1.clientSent).toBe(1);
    expect(run1.sent).toBe(3); // all three get the consultant 24h reminder

    expect((await getBooking('c1')).clientReminderSentAt).toBeTruthy();
    expect((await getBooking('c2')).clientReminderSentAt).toBeFalsy();
    expect((await getBooking('c3')).clientReminderSentAt).toBeFalsy();

    // c3 becomes due once inside the window — and c1 never re-sends.
    const later = new Date(NOW.getTime() + 2.5 * 3_600_000);
    const run2 = await sendConsultationRemindersDue(later);
    expect(run2.clientSent).toBe(1);
    expect((await getBooking('c3')).clientReminderSentAt).toBeTruthy();

    const run3 = await sendConsultationRemindersDue(later);
    expect(run3.clientSent).toBe(0);
  });

  it('bookingStartMs resolves scheduledAt first, then Algiers date+time', () => {
    expect(bookingStartMs({ scheduledAt: '2026-03-10T12:00:00.000Z', consultationDate: null, consultationTime: null }))
      .toBe(Date.parse('2026-03-10T12:00:00.000Z'));
    // 13:00 Algiers (UTC+1) = 12:00 UTC.
    expect(bookingStartMs({ scheduledAt: null, consultationDate: '2026-03-10', consultationTime: '13:00' }))
      .toBe(Date.parse('2026-03-10T12:00:00.000Z'));
    expect(bookingStartMs({ scheduledAt: null, consultationDate: null, consultationTime: null })).toBeNull();
  });
});

describe('admin publish gate (isMentorPubliclyListed + setMentorPublished)', () => {
  it('an admin-published SELF consultant appears in the public list; default SELF stays hidden', async () => {
    await db.update((d) => {
      d.mentors = [
        { ...MENTOR, id: 'm-legacy' }, // legacy admin mentor (no flags) → listed
        { ...MENTOR, id: 'm-self-hidden', source: 'SELF', approvalStatus: 'APPROVED', publiclyListed: false },
        { ...MENTOR, id: 'm-self-published', source: 'SELF', approvalStatus: 'APPROVED', publiclyListed: true },
        { ...MENTOR, id: 'm-self-pending', source: 'SELF', approvalStatus: 'PENDING', publiclyListed: false },
      ];
    });
    const publicIds = (await listPublicMentors()).map((m) => m.id).sort();
    expect(publicIds).toEqual(['m-legacy', 'm-self-published']);
  });

  it('setMentorPublished publishes approved consultants, refuses pending, and unpublishes', async () => {
    await db.update((d) => {
      d.mentors = [
        { ...MENTOR, id: 'm-a', source: 'SELF', approvalStatus: 'APPROVED', publiclyListed: false },
        { ...MENTOR, id: 'm-p', source: 'SELF', approvalStatus: 'PENDING', publiclyListed: false },
      ];
      d.auditLogs = [];
    });
    const admin = { id: 'admin-1', email: 'admin@example.com' };

    const pub = await setMentorPublished({ mentorId: 'm-a', publiclyListed: true, admin });
    expect(pub.ok && pub.mentor.publiclyListed).toBe(true);
    expect((await listPublicMentors()).some((m) => m.id === 'm-a')).toBe(true);

    // A pending profile can never be published.
    const pend = await setMentorPublished({ mentorId: 'm-p', publiclyListed: true, admin });
    expect(pend.ok).toBe(false);
    if (!pend.ok) expect(pend.reason).toBe('NOT_APPROVED');

    // Unpublish removes it from the public list again.
    const unpub = await setMentorPublished({ mentorId: 'm-a', publiclyListed: false, admin });
    expect(unpub.ok && unpub.mentor.publiclyListed).toBe(false);
    expect((await listPublicMentors()).some((m) => m.id === 'm-a')).toBe(false);
  });
});
