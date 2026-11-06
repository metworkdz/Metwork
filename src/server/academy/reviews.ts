/**
 * Course reviews (stars + optional text).
 *
 * Owner rule (2026-11-01): learners who have the course (bought or Pass) and
 * watched at least 25 % of it may review; a review is live at once, the admin
 * can hide it, and the course's mentor may reply once, publicly. One review
 * per learner and course; posting again edits it.
 */
import { randomUUID } from 'node:crypto';
import { db, type AcademyReviewRecord } from '@/server/db/store';
import { ACADEMY_REVIEW_MIN_WATCHED, isLiveModule } from '@/lib/academy';
import { resolveText } from '@/lib/localized-text';
import { academyRepo } from './repo';
import { courseReach, type Viewer } from './access';

export const REVIEW_TEXT_MAX = 2000;
export const REVIEW_REPLY_MAX = 1500;

export interface PublicReview {
  id: string;
  /** "Amina B." — never the full name or anything that leads to the account. */
  author: string;
  rating: number;
  text: string | null;
  createdAt: string;
  updatedAt: string;
  reply: { mentorName: string; text: string; at: string } | null;
}

export interface ReviewEligibility {
  canReview: boolean;
  /** Why not, when not. */
  reason: 'NOT_LEARNER' | 'WATCH_MORE' | null;
  mine: { rating: number; text: string | null } | null;
}

/** "Amina Benali" → "Amina B." */
export function reviewerName(fullName: string | undefined | null): string {
  const parts = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  const last = parts.length > 1 ? parts[parts.length - 1]! : '';
  return last ? `${parts[0]} ${last.charAt(0).toUpperCase()}.` : parts[0]!;
}

export async function reviewEligibility(viewer: Viewer, courseId: string): Promise<ReviewEligibility | null> {
  const reach = await courseReach(viewer, courseId);
  if (!reach.ok) return null;
  const own = reach.d.academyReviews?.find((r) => r.userId === viewer.id && r.courseId === courseId);
  const mine = own ? { rating: own.rating, text: own.text } : null;
  if (reach.access !== 'OWNED' && reach.access !== 'PASS') return { canReview: false, reason: 'NOT_LEARNER', mine };
  const total = reach.course.modules.filter(isLiveModule).flatMap((m) => m.lessons).reduce((s, l) => s + l.durationSec, 0);
  const watched = await academyRepo().courseWatchSeconds(viewer.id, courseId);
  if (total <= 0 || watched < total * ACADEMY_REVIEW_MIN_WATCHED) return { canReview: false, reason: 'WATCH_MORE', mine };
  return { canReview: true, reason: null, mine };
}

export type ReviewError = 'NOT_FOUND' | 'NOT_LEARNER' | 'WATCH_MORE' | 'ALREADY_REPLIED' | 'NOT_YOUR_COURSE';

export async function saveReview(
  viewer: Viewer, courseId: string, input: { rating: number; text: string | null },
): Promise<{ ok: true; review: AcademyReviewRecord } | { ok: false; code: ReviewError }> {
  const elig = await reviewEligibility(viewer, courseId);
  if (!elig) return { ok: false, code: 'NOT_FOUND' };
  if (!elig.canReview) return { ok: false, code: elig.reason ?? 'NOT_LEARNER' };
  const text = input.text?.trim() ? input.text.trim().slice(0, REVIEW_TEXT_MAX) : null;
  const rating = Math.min(5, Math.max(1, Math.round(input.rating)));
  const at = new Date().toISOString();
  const review = await db.update((d) => {
    if (!Array.isArray(d.academyReviews)) d.academyReviews = [];
    let r = d.academyReviews.find((x) => x.userId === viewer.id && x.courseId === courseId);
    if (!r) {
      r = { id: randomUUID(), userId: viewer.id, courseId, rating, text, createdAt: at, updatedAt: at, hiddenAt: null, hiddenBy: null, reply: null };
      d.academyReviews.push(r);
    } else {
      // A hidden review stays hidden when edited: the admin decides again.
      r.rating = rating;
      r.text = text;
      r.updatedAt = at;
    }
    return { ...r };
  });
  return { ok: true, review };
}

export async function deleteMyReview(userId: string, courseId: string): Promise<boolean> {
  return db.update((d) => {
    const before = d.academyReviews?.length ?? 0;
    d.academyReviews = (d.academyReviews ?? []).filter((r) => !(r.userId === userId && r.courseId === courseId));
    return d.academyReviews.length < before;
  });
}

/** A course's visible reviews, newest first. */
export async function listCourseReviews(courseId: string, limit = 50): Promise<PublicReview[]> {
  const d = await db.read();
  return (d.academyReviews ?? [])
    .filter((r) => r.courseId === courseId && !r.hiddenAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit)
    .map((r) => ({
      id: r.id,
      author: reviewerName(d.users.find((u) => u.id === r.userId)?.fullName),
      rating: r.rating,
      text: r.text,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      reply: r.reply ? { mentorName: d.mentors.find((m) => m.id === r.reply!.mentorId)?.fullName ?? '', text: r.reply.text, at: r.reply.at } : null,
    }));
}

/** The course's mentor answers a review — once. */
export async function replyToReview(mentorId: string, reviewId: string, text: string): Promise<{ ok: true } | { ok: false; code: ReviewError }> {
  const body = text.trim().slice(0, REVIEW_REPLY_MAX);
  if (!body) return { ok: false, code: 'NOT_FOUND' };
  return db.update((d) => {
    const r = d.academyReviews?.find((x) => x.id === reviewId);
    if (!r) return { ok: false as const, code: 'NOT_FOUND' as const };
    const course = d.academyCourses?.find((c) => c.id === r.courseId);
    if (!course?.mentorIds.includes(mentorId)) return { ok: false as const, code: 'NOT_YOUR_COURSE' as const };
    if (r.reply) return { ok: false as const, code: 'ALREADY_REPLIED' as const };
    r.reply = { mentorId, text: body, at: new Date().toISOString() };
    return { ok: true as const };
  });
}

/** Admin moderation. */
export async function setReviewHidden(reviewId: string, adminId: string, hidden: boolean): Promise<boolean> {
  return db.update((d) => {
    const r = d.academyReviews?.find((x) => x.id === reviewId);
    if (!r) return false;
    r.hiddenAt = hidden ? (r.hiddenAt ?? new Date().toISOString()) : null;
    r.hiddenBy = hidden ? adminId : null;
    return true;
  });
}

export interface ModerationReview extends PublicReview { courseId: string; courseTitle: string; hidden: boolean }

/** Every review of the given courses (mentor Studio) or of all courses (admin), hidden included for admins. */
export async function listReviewsForManagers(opts: { courseIds?: string[]; includeHidden: boolean; locale: string; limit?: number }): Promise<ModerationReview[]> {
  const d = await db.read();
  const ids = opts.courseIds ? new Set(opts.courseIds) : null;
  return (d.academyReviews ?? [])
    .filter((r) => (!ids || ids.has(r.courseId)) && (opts.includeHidden || !r.hiddenAt))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, opts.limit ?? 100)
    .map((r) => {
      const course = d.academyCourses?.find((c) => c.id === r.courseId);
      return {
        id: r.id,
        courseId: r.courseId,
        courseTitle: course ? resolveText(course.title, opts.locale) : '',
        author: reviewerName(d.users.find((u) => u.id === r.userId)?.fullName),
        rating: r.rating,
        text: r.text,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        hidden: Boolean(r.hiddenAt),
        reply: r.reply ? { mentorName: d.mentors.find((m) => m.id === r.reply!.mentorId)?.fullName ?? '', text: r.reply.text, at: r.reply.at } : null,
      };
    });
}
