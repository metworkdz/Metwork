/**
 * Space-rental expiry reminders.
 *
 * Scans CONFIRMED desk / office holds (`DeskBookingRecord`) whose parent booking
 * is ending in 1–2 days and emails the owning incubator manager a "rental ending
 * soon" reminder — once per booking (guarded by `expiryReminderSentAt`).
 *
 * Designed to be run daily by a cron route. All email sends are fire-and-forget
 * (`sendSpaceExpiryReminderEmail` never throws), so a delivery failure can never
 * break the caller.
 */
import { db } from '@/server/db/store';
import type { DeskBookingRecord } from '@/server/db/store';
import { sendSpaceExpiryReminderEmail } from '@/server/notifications/email';

/** "YYYY-MM-DD" for `base` shifted by `n` whole UTC days. */
function addDaysUTC(base: Date, n: number): string {
  const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + n));
  return d.toISOString().slice(0, 10);
}

/** Human-readable end date, e.g. "Monday 30 June 2026" (EN, UTC). */
function formatEndDate(date: string): string {
  const ms = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(ms)) return date;
  return new Date(ms).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

/**
 * Send rental-ending reminders for desk/office bookings ending tomorrow
 * (today + 1) or in two days (today + 2). Marks `expiryReminderSentAt` on every
 * desk record of a booking once its reminder has been dispatched, so the next
 * run never double-sends. Returns counts for the cron route.
 */
export async function checkAndSendExpiryReminders(): Promise<{ sent: number; checked: number }> {
  const data = await db.read();

  // Eligible holds: active, not-yet-reminded, and linked to a parent booking.
  const candidates = (data.deskBookings ?? []).filter(
    (b) => b.status === 'CONFIRMED' && b.expiryReminderSentAt == null && b.bookingId,
  );

  // Group by parent booking — one reminder per booking covers all its days.
  const groups = new Map<string, DeskBookingRecord[]>();
  for (const rec of candidates) {
    const key = rec.bookingId as string;
    const arr = groups.get(key);
    if (arr) arr.push(rec);
    else groups.set(key, [rec]);
  }

  const today = new Date();
  const plus1 = addDaysUTC(today, 1);
  const plus2 = addDaysUTC(today, 2);

  const bookingIdsToMark: string[] = [];
  let sent = 0;

  for (const [bookingId, records] of groups) {
    // End date = latest day held across the booking (DAY records are "YYYY-MM-DD",
    // so lexicographic max is chronological max).
    const endDate = records.reduce((max, r) => (r.date > max ? r.date : max), records[0]!.date);
    if (endDate !== plus1 && endDate !== plus2) continue;

    const first = records[0]!;
    const incubator = (data.incubators ?? []).find((i) => i.id === first.incubatorId);
    const manager = incubator?.managerId
      ? (data.users ?? []).find((u) => u.id === incubator.managerId)
      : null;
    const email = manager?.email;
    if (!incubator || !email) continue; // can't deliver → leave unmarked so a later run retries

    const space = (data.spaces ?? []).find((s) => s.id === first.spaceId);

    sendSpaceExpiryReminderEmail(email, {
      incubatorName: incubator.name,
      clientName: first.clientName ?? '—',
      deskName: first.deskName,
      spaceName: space?.name ?? first.spaceId,
      endDate: formatEndDate(endDate),
      bookingId,
    });
    sent += 1;
    bookingIdsToMark.push(bookingId);
  }

  // Mark every desk record of the reminded bookings in one atomic pass.
  if (bookingIdsToMark.length > 0) {
    const markSet = new Set(bookingIdsToMark);
    const now = new Date().toISOString();
    await db.update((d) => {
      for (const rec of d.deskBookings ?? []) {
        if (rec.bookingId && markSet.has(rec.bookingId) && rec.expiryReminderSentAt == null) {
          rec.expiryReminderSentAt = now;
        }
      }
    });
  }

  return { sent, checked: groups.size };
}
