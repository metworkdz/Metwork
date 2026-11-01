/**
 * Startup Academy learner notifications (in-app + push, and email where it
 * matters):
 *   - certificate issued (in-app + email with the PDF);
 *   - a module goes live on a course (in-app + push) for its buyers, the
 *     learners who wishlisted it, and Pass learners who have started it;
 *   - "keep going" reminder emails for courses left idle (daily cron).
 *
 * In-app texts are French, like the Academy's other notifications. Nothing
 * here throws into its caller: a failed notice never undoes the action.
 */
import { randomUUID } from 'node:crypto';
import { db, type AcademyCertificateRecord, type AcademyCourseRecord, type NotificationRecord } from '@/server/db/store';
import { resolveText } from '@/lib/localized-text';
import { isLiveModule } from '@/lib/academy';
import { createNotification } from '@/server/notifications/create-notification';
import { pushToUser } from '@/server/notifications/push';
import { academyRepo } from './repo';
import { activeEnrollment } from './orders';
import { activePass } from './pass-core';
import { academyCertificateVerifyUrl, activeCertificate, certificateProgress, renderAcademyCertificatePdf } from './certificates';
import { sendAcademyEmail } from './emails';

/* ─────────────────────────── Certificate ─────────────────────────── */

/** Tell the learner, once (the email is claimed with `emailedAt`). */
export async function notifyCertificateIssued(cert: AcademyCertificateRecord): Promise<void> {
  try {
    const claimed = await db.update((d) => {
      const c = d.academyCertificates?.find((x) => x.id === cert.id);
      if (!c || c.emailedAt) return null;
      c.emailedAt = new Date().toISOString();
      const user = d.users.find((u) => u.id === c.userId);
      const course = d.academyCourses?.find((x) => x.id === c.courseId);
      return user ? { user, slug: course?.slug ?? null } : null;
    });
    if (!claimed) return;
    await createNotification({
      userId: cert.userId,
      type: 'ACADEMY_LEARNING',
      title: 'Certificat obtenu',
      body: `Votre certificat pour « ${cert.courseTitle} » est prêt.`,
      href: '/academy/my',
    });
    const pdf = await renderAcademyCertificatePdf(cert).catch(() => null);
    await sendAcademyEmail({
      kind: 'CERTIFICATE', to: claimed.user.email, lang: claimed.user.locale, name: claimed.user.fullName,
      courseTitle: cert.courseTitle, number: cert.number, verifyUrl: academyCertificateVerifyUrl(cert.verifyToken), pdf,
    });
  } catch (err) {
    console.error('[academy] certificate notice failed:', err);
  }
}

/* ─────────────────────────── New module live ─────────────────────────── */

/** Modules live in `after` that were not live in `before` (published courses only). */
export function newlyLiveModules(before: AcademyCourseRecord | null, after: AcademyCourseRecord): string[] {
  if (after.status !== 'PUBLISHED' || before?.status !== 'PUBLISHED') return [];
  const wasLive = new Set(before.modules.filter(isLiveModule).map((m) => m.id));
  return after.modules.filter((m) => isLiveModule(m) && !wasLive.has(m.id)).map((m) => m.id);
}

export async function notifyModulesReleased(before: AcademyCourseRecord | null, after: AcademyCourseRecord): Promise<number> {
  const ids = newlyLiveModules(before, after);
  if (!ids.length) return 0;
  try {
    const d = await db.read();
    const recipients = new Set<string>();
    for (const e of d.academyEnrollments ?? []) if (e.courseId === after.id && activeEnrollment([e], e.userId, after.id)) recipients.add(e.userId);
    for (const u of d.users) if (u.academyWishlist?.includes(after.id)) recipients.add(u.id);
    if (after.includedInPass) {
      // Pass learners who have opened the course: they are the ones following it.
      const since = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString();
      const started = await academyRepo().inactiveLearners(since, new Date(Date.now() + 60_000).toISOString());
      for (const s of started) if (s.courseId === after.id && activePass(d, s.userId)) recipients.add(s.userId);
    }
    if (!recipients.size) return 0;
    const titles = after.modules.filter((m) => ids.includes(m.id)).map((m) => resolveText(m.title, 'fr'));
    const title = 'Nouveau module disponible';
    const body = `« ${resolveText(after.title, 'fr')} » : ${titles.join(', ')}`;
    const href = `/academy/learn/${after.slug}`;
    const at = new Date().toISOString();
    // One write for everyone, then the phones.
    await db.update((doc) => {
      if (!Array.isArray(doc.notifications)) doc.notifications = [];
      for (const userId of recipients) {
        const n: NotificationRecord = { id: randomUUID(), userId, type: 'ACADEMY_LEARNING', title, body, href, read: false, createdAt: at };
        doc.notifications.push(n);
      }
    });
    await Promise.allSettled([...recipients].map((userId) => pushToUser(userId, { title, body, url: href })));
    return recipients.size;
  } catch (err) {
    console.error('[academy] module release notice failed:', err);
    return 0;
  }
}

/* ─────────────────────────── Reminder emails ─────────────────────────── */

const DAY = 24 * 3600 * 1000;
/** Idle for a week (but not more than two: an older pause is left alone). */
export const REMINDER_IDLE_DAYS = 7;
const REMINDER_WINDOW_DAYS = 14;
/** Never more than this many reminders for one course. */
export const REMINDER_MAX_PER_COURSE = 3;
const REMINDER_BATCH = 200;

export interface ReminderRun { candidates: number; sent: number; skipped: number }

/**
 * Daily: one "keep going" email per learner and course whose last progress was
 * 7–14 days ago, at most once per pause and three times per course, only while
 * they still have the course and have not finished it.
 */
export async function runAcademyReminders(now = new Date()): Promise<ReminderRun> {
  const idle = await academyRepo().inactiveLearners(
    new Date(now.getTime() - REMINDER_WINDOW_DAYS * DAY).toISOString(),
    new Date(now.getTime() - REMINDER_IDLE_DAYS * DAY).toISOString(),
  );
  const run: ReminderRun = { candidates: idle.length, sent: 0, skipped: 0 };
  const d = await db.read();
  for (const x of idle.slice(0, REMINDER_BATCH)) {
    const user = d.users.find((u) => u.id === x.userId);
    const course = d.academyCourses?.find((c) => c.id === x.courseId);
    const log = d.academyReminders?.find((r) => r.userId === x.userId && r.courseId === x.courseId);
    const hasCourse = Boolean(course && (activeEnrollment(d.academyEnrollments, x.userId, x.courseId)
      || (course.status === 'PUBLISHED' && course.includedInPass && activePass(d, x.userId, now))));
    if (!user?.email || user.academyRemindersOff || !course || !hasCourse
      || (log && (log.count >= REMINDER_MAX_PER_COURSE || log.lastSentAt > x.lastAt))
      || activeCertificate(d, x.userId, x.courseId)) { run.skipped++; continue; }
    const progress = await certificateProgress(x.userId, course, d);
    if (progress.lessonsTotal === 0 || progress.lessonsDone >= progress.lessonsTotal) { run.skipped++; continue; }

    // Claim before sending: a second run the same day finds the stamp.
    const claimed = await db.update((doc) => {
      if (!Array.isArray(doc.academyReminders)) doc.academyReminders = [];
      let r = doc.academyReminders.find((y) => y.userId === x.userId && y.courseId === x.courseId);
      if (r && (r.count >= REMINDER_MAX_PER_COURSE || r.lastSentAt > x.lastAt)) return false;
      if (!r) { r = { userId: x.userId, courseId: x.courseId, count: 0, lastSentAt: now.toISOString() }; doc.academyReminders.push(r); }
      r.count += 1;
      r.lastSentAt = now.toISOString();
      return true;
    });
    if (!claimed) { run.skipped++; continue; }
    await sendAcademyEmail({
      kind: 'REMINDER', to: user.email, lang: user.locale, name: user.fullName,
      courseTitle: resolveText(course.title, user.locale), slug: course.slug, done: progress.lessonsDone, total: progress.lessonsTotal,
    });
    run.sent++;
  }
  return run;
}
