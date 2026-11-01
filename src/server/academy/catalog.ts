/**
 * Startup Academy catalogue — THE place courses are created, edited, published
 * and read. Admin authoring goes through `createCourse` / `saveCourseDraft` /
 * `setCourseStatus`; public pages read through `listPublicCourses` /
 * `getPublicCourse` / `getPublicMentor`, which return DTOs with every title
 * already resolved to the reader's language and NO video ids.
 *
 * Security: a provider video id is the key to the encrypted video. It stays in
 * the store and only leaves the server inside a playback token (phase 2).
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  db,
  type AcademyCourseRecord,
  type AcademyLessonRecord,
  type AcademyModuleRecord,
  type MentorRecord,
} from '@/server/db/store';
import {
  ACADEMY_AUDIO_LANGUAGES,
  ACADEMY_LEVELS,
  ACADEMY_MIN_COURSE_PRICE_DZD,
  coursePriceError,
  discounted,
  isLiveModule,
  isVisibleModule,
  type AcademyAudioLanguage,
  type AcademyLevel,
} from '@/lib/academy';
import { isLocalizedText, resolveText, type LocalizedText } from '@/lib/localized-text';
import { locales } from '@/i18n/config';
import { slugify, uniqueSlug } from '@/lib/slugify';
import { isMentorApproved, isMentorPubliclyListed } from '@/lib/mentor-approval';
import { getAcademyPricing, listAcademyFields } from './settings';

/* ─────────────────────────── Validation ─────────────────────────── */

export const LIMITS = {
  title: 120,
  subtitle: 200,
  description: 5000,
  outcome: 160,
  outcomes: 12,
  modules: 30,
  lessonsPerModule: 60,
  mentors: 3,
} as const;

/** A LocalizedText with every language at most `max` characters. */
const localized = (max: number) =>
  z.custom<LocalizedText>((v) => isLocalizedText(v), { message: 'Invalid localized text' })
    .refine((t) => locales.every((l) => (t[l] ?? '').length <= max), { message: `Max ${max} characters` })
    .transform((t) => normalize(t));

/** Keep only known keys, trimmed; drop empty translations. */
function normalize(t: LocalizedText): LocalizedText {
  const out: LocalizedText = { source: t.source };
  for (const l of locales) {
    const v = (t[l] ?? '').trim();
    if (v) out[l] = v;
  }
  const drafted = (t.drafted ?? []).filter((l) => l !== t.source && out[l]);
  if (drafted.length) out.drafted = locales.filter((l) => drafted.includes(l));
  return out;
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const lessonSchema = z.object({
  id: z.string().regex(ID_RE).optional(),
  title: localized(LIMITS.title),
  description: localized(LIMITS.description).nullable().default(null),
  isPreview: z.boolean().default(false),
});

const moduleSchema = z.object({
  id: z.string().regex(ID_RE).optional(),
  title: localized(LIMITS.title),
  comingSoon: z.boolean().default(false),
  lessons: z.array(lessonSchema).max(LIMITS.lessonsPerModule),
});

/** What the builder sends on save. Video fields are deliberately absent: only uploads set them. */
export const courseDraftSchema = z.object({
  slug: z.string().min(3).max(80).regex(SLUG_RE).optional(),
  fieldId: z.string().regex(ID_RE),
  mentorIds: z.array(z.string().regex(ID_RE)).min(1).max(LIMITS.mentors),
  title: localized(LIMITS.title),
  subtitle: localized(LIMITS.subtitle).nullable().default(null),
  description: localized(LIMITS.description).nullable().default(null),
  outcomes: z.array(localized(LIMITS.outcome)).max(LIMITS.outcomes).default([]),
  level: z.enum(ACADEMY_LEVELS),
  audioLanguage: z.enum(ACADEMY_AUDIO_LANGUAGES),
  priceDzd: z.number().int(),
  includedInPass: z.boolean(),
  // Cloudinary in production (the only image host the CSP allows); `/uploads/…` is
  // the dev-only local fallback of /api/upload.
  thumbnailUrl: z.string().max(500).refine((u) => /^https:\/\/res\.cloudinary\.com\/[^\s]+$/.test(u) || /^\/uploads\/[\w/.-]+$/.test(u), 'Cloudinary image only').nullable(),
  modules: z.array(moduleSchema).max(LIMITS.modules),
});
export type CourseDraftInput = z.infer<typeof courseDraftSchema>;

export const createCourseSchema = z.object({
  title: localized(LIMITS.title),
  fieldId: z.string().regex(ID_RE),
  mentorIds: z.array(z.string().regex(ID_RE)).min(1).max(LIMITS.mentors),
});
export type CreateCourseInput = z.infer<typeof createCourseSchema>;

export type CatalogError =
  | 'NOT_FOUND'
  | 'FIELD_NOT_FOUND'
  | 'MENTOR_NOT_FOUND'
  | 'SLUG_TAKEN'
  | 'PRICE_BELOW_MINIMUM'
  | 'PRICE_INVALID'
  | 'HAS_ENROLLMENTS';

export type CatalogResult<T> = { ok: true; value: T } | { ok: false; code: CatalogError };

/* ─────────────────────────── Authoring (admin) ─────────────────────────── */

async function checkRefs(fieldId: string, mentorIds: string[]): Promise<CatalogError | null> {
  const fields = await listAcademyFields({ includeHidden: true });
  if (!fields.some((f) => f.id === fieldId)) return 'FIELD_NOT_FOUND';
  const d = await db.read();
  if (!mentorIds.every((id) => d.mentors.some((m) => m.id === id))) return 'MENTOR_NOT_FOUND';
  return null;
}

/** Open a draft. The slug comes from the title; everything else gets a sensible default. */
export async function createCourse(
  input: CreateCourseInput,
  by: { kind: 'ADMIN' | 'MENTOR'; id: string },
): Promise<CatalogResult<AcademyCourseRecord>> {
  const refErr = await checkRefs(input.fieldId, input.mentorIds);
  if (refErr) return { ok: false, code: refErr };
  const now = new Date().toISOString();
  const course = await db.update((d) => {
    if (!Array.isArray(d.academyCourses)) d.academyCourses = [];
    const base = slugify(resolveText(input.title, input.title.source)) || 'cours';
    const c: AcademyCourseRecord = {
      id: randomUUID(),
      slug: uniqueSlug(base, d.academyCourses.map((x) => x.slug)),
      fieldId: input.fieldId,
      mentorIds: [...new Set(input.mentorIds)],
      title: input.title,
      subtitle: null,
      description: null,
      outcomes: [],
      level: 'BEGINNER',
      audioLanguage: 'DARIJA_FR',
      priceDzd: ACADEMY_MIN_COURSE_PRICE_DZD,
      includedInPass: true,
      thumbnailUrl: null,
      trailerVideoId: null,
      modules: [],
      status: 'DRAFT',
      createdBy: by,
      reviewNote: null,
      submittedAt: null,
      publishedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    d.academyCourses.push(c);
    return c;
  });
  return { ok: true, value: course };
}

/** Builder ids that are not in this course yet get a fresh server id. */
function keepOrNewId(id: string | undefined, known: Set<string>): string {
  return id && known.has(id) ? id : randomUUID();
}

/**
 * Save the whole builder state. Structure and texts come from the request;
 * each lesson's video (id, status, length) and files are carried over from the
 * stored lesson with the same id, so a request can never point a lesson at
 * another video.
 */
export interface SaveOptions {
  /** Mentor edits of a published course: modules the course does not have yet start pending review. */
  newModulesPendingReview?: boolean;
}

export async function saveCourseDraft(courseId: string, input: CourseDraftInput, opts: SaveOptions = {}): Promise<CatalogResult<AcademyCourseRecord>> {
  // Validate everything before the store update: db.update has no rollback.
  const priceErr = coursePriceError(input.priceDzd);
  if (priceErr === 'BELOW_MINIMUM') return { ok: false, code: 'PRICE_BELOW_MINIMUM' };
  if (priceErr) return { ok: false, code: 'PRICE_INVALID' };
  const refErr = await checkRefs(input.fieldId, input.mentorIds);
  if (refErr) return { ok: false, code: refErr };

  const current = (await db.read()).academyCourses?.find((c) => c.id === courseId);
  if (!current) return { ok: false, code: 'NOT_FOUND' };
  if (input.slug && input.slug !== current.slug) {
    const taken = (await db.read()).academyCourses?.some((c) => c.id !== courseId && c.slug === input.slug);
    if (taken) return { ok: false, code: 'SLUG_TAKEN' };
  }

  const saved = await db.update((d) => {
    const c = d.academyCourses?.find((x) => x.id === courseId);
    if (!c) return null;
    const oldLessons = new Map(c.modules.flatMap((m) => m.lessons).map((l) => [l.id, l]));
    const oldModules = new Map(c.modules.map((m) => [m.id, m]));
    const moduleIds = new Set(c.modules.map((m) => m.id));
    const lessonIds = new Set(oldLessons.keys());
    const used = new Set<string>();

    const modules: AcademyModuleRecord[] = input.modules.map((m) => {
      let id = keepOrNewId(m.id, moduleIds);
      if (used.has(id)) id = randomUUID();
      used.add(id);
      // Review state is never set by the builder: kept from the stored module,
      // and only the mentor path opens new modules as pending.
      const prevModule = oldModules.get(id);
      const pendingReview = prevModule ? Boolean(prevModule.pendingReview) : Boolean(opts.newModulesPendingReview);
      return {
        id,
        title: m.title,
        comingSoon: m.comingSoon,
        ...(pendingReview ? { pendingReview: true } : {}),
        lessons: m.lessons.map((l): AcademyLessonRecord => {
          let lessonId = keepOrNewId(l.id, lessonIds);
          if (used.has(lessonId)) lessonId = randomUUID();
          used.add(lessonId);
          const prev = oldLessons.get(lessonId);
          return {
            id: lessonId,
            title: l.title,
            description: l.description,
            kind: 'VIDEO',
            videoId: prev?.videoId ?? null,
            videoStatus: prev?.videoStatus ?? 'NONE',
            durationSec: prev?.durationSec ?? 0,
            isPreview: l.isPreview,
            resources: prev?.resources ?? [],
          };
        }),
      };
    });

    Object.assign(c, {
      slug: input.slug ?? c.slug,
      fieldId: input.fieldId,
      mentorIds: [...new Set(input.mentorIds)],
      title: input.title,
      subtitle: input.subtitle,
      description: input.description,
      outcomes: input.outcomes,
      level: input.level,
      audioLanguage: input.audioLanguage,
      priceDzd: input.priceDzd,
      includedInPass: input.includedInPass,
      thumbnailUrl: input.thumbnailUrl,
      modules,
      updatedAt: new Date().toISOString(),
    });
    return c;
  });
  return saved ? { ok: true, value: saved } : { ok: false, code: 'NOT_FOUND' };
}

/** Why a course cannot go live, in the order an author would fix them. */
export type PublishProblem =
  | 'NO_THUMBNAIL'
  | 'NO_RELEASED_LESSON'
  | 'VIDEO_NOT_READY'
  | 'NO_DESCRIPTION'
  | 'MENTOR_NOT_APPROVED'
  | 'FIELD_NOT_FOUND'
  | 'PRICE_INVALID';

export async function publishProblems(course: AcademyCourseRecord): Promise<PublishProblem[]> {
  const problems: PublishProblem[] = [];
  if (!course.thumbnailUrl) problems.push('NO_THUMBNAIL');
  if (!course.description) problems.push('NO_DESCRIPTION');
  const released = course.modules.filter(isLiveModule);
  const lessons = released.flatMap((m) => m.lessons);
  if (!lessons.length) problems.push('NO_RELEASED_LESSON');
  if (lessons.some((l) => l.videoStatus !== 'READY')) problems.push('VIDEO_NOT_READY');
  const d = await db.read();
  const mentors = course.mentorIds.map((id) => d.mentors.find((m) => m.id === id));
  if (!mentors.length || mentors.some((m) => !m || !isMentorApproved(m))) problems.push('MENTOR_NOT_APPROVED');
  const fields = await listAcademyFields({ includeHidden: true });
  if (!fields.some((f) => f.id === course.fieldId)) problems.push('FIELD_NOT_FOUND');
  if (coursePriceError(course.priceDzd)) problems.push('PRICE_INVALID');
  return problems;
}

export type StatusChange = 'PUBLISH' | 'UNPUBLISH' | 'ARCHIVE';

export type StatusResult =
  | { ok: true; course: AcademyCourseRecord }
  | { ok: false; code: 'NOT_FOUND' }
  | { ok: false; code: 'NOT_READY'; problems: PublishProblem[] };

/**
 * Admin status changes. Publishing re-checks everything at that moment.
 * Archiving hides the course from the catalogue and the Pass; buyers keep
 * access (owner decision 9), which phase 2 reads from enrollments.
 */
export async function setCourseStatus(courseId: string, change: StatusChange): Promise<StatusResult> {
  const course = (await db.read()).academyCourses?.find((c) => c.id === courseId);
  if (!course) return { ok: false, code: 'NOT_FOUND' };
  if (change === 'PUBLISH') {
    const problems = await publishProblems(course);
    if (problems.length) return { ok: false, code: 'NOT_READY', problems };
  }
  const updated = await db.update((d) => {
    const c = d.academyCourses?.find((x) => x.id === courseId);
    if (!c) return null;
    const now = new Date().toISOString();
    if (change === 'PUBLISH') {
      c.status = 'PUBLISHED';
      c.publishedAt = c.publishedAt ?? now;
      c.reviewNote = null;
    } else if (change === 'UNPUBLISH') {
      c.status = 'DRAFT';
    } else {
      c.status = 'ARCHIVED';
    }
    c.updatedAt = now;
    return c;
  });
  return updated ? { ok: true, course: updated } : { ok: false, code: 'NOT_FOUND' };
}

/** Delete a course that nobody has bought. Anything bought is archived instead. */
export async function deleteCourse(courseId: string): Promise<CatalogResult<null>> {
  const d0 = await db.read();
  if (!d0.academyCourses?.some((c) => c.id === courseId)) return { ok: false, code: 'NOT_FOUND' };
  if ((d0.academyEnrollments ?? []).some((e) => e.courseId === courseId)) return { ok: false, code: 'HAS_ENROLLMENTS' };
  await db.update((d) => {
    d.academyCourses = (d.academyCourses ?? []).filter((c) => c.id !== courseId);
  });
  return { ok: true, value: null };
}

export async function getCourseForAdmin(courseId: string): Promise<AcademyCourseRecord | null> {
  return (await db.read()).academyCourses?.find((c) => c.id === courseId) ?? null;
}

export async function listCoursesForAdmin(): Promise<AcademyCourseRecord[]> {
  const d = await db.read();
  return [...(d.academyCourses ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * The admin view of a course minus video ids. The builder shows a lesson's
 * upload state, never the id: even an admin's browser does not need the key.
 */
export function redactCourseForBuilder(c: AcademyCourseRecord) {
  return {
    ...c,
    trailerVideoId: undefined,
    hasTrailer: Boolean(c.trailerVideoId),
    modules: c.modules.map((m) => ({
      ...m,
      lessons: m.lessons.map(({ videoId, ...l }) => ({ ...l, hasVideo: Boolean(videoId) })),
    })),
  };
}
export type BuilderCourse = ReturnType<typeof redactCourseForBuilder>;

/* ─────────────────────────── Public reads ─────────────────────────── */

export interface PublicMentorChip {
  id: string;
  slug: string;
  fullName: string;
  position: string;
  avatarUrl: string | null;
}

export interface PublicCourseCard {
  id: string;
  slug: string;
  title: string;
  subtitle: string;
  fieldId: string;
  level: AcademyLevel;
  audioLanguage: AcademyAudioLanguage;
  priceDzd: number;
  premiumPriceDzd: number;
  includedInPass: boolean;
  thumbnailUrl: string | null;
  durationSec: number;
  lessonCount: number;
  comingSoonModules: number;
  mentors: PublicMentorChip[];
  publishedAt: string | null;
}

export interface PublicLesson { id: string; title: string; durationSec: number; isPreview: boolean }
export interface PublicModule { id: string; title: string; comingSoon: boolean; durationSec: number; lessons: PublicLesson[] }

export interface PublicCourseDetail extends PublicCourseCard {
  description: string;
  outcomes: string[];
  modules: PublicModule[];
}

function mentorSlug(m: MentorRecord): string {
  return m.slug || m.id;
}

function mentorChip(m: MentorRecord): PublicMentorChip {
  return {
    id: m.id,
    slug: mentorSlug(m),
    fullName: m.fullName,
    position: m.position,
    avatarUrl: m.avatarUrl ?? m.imageUrl ?? null,
  };
}

const releasedLessons = (c: AcademyCourseRecord) => c.modules.filter(isLiveModule).flatMap((m) => m.lessons);

function toCard(c: AcademyCourseRecord, locale: string, mentors: MentorRecord[], premiumRate: number): PublicCourseCard {
  const lessons = releasedLessons(c);
  return {
    id: c.id,
    slug: c.slug,
    title: resolveText(c.title, locale),
    subtitle: resolveText(c.subtitle, locale),
    fieldId: c.fieldId,
    level: c.level,
    audioLanguage: c.audioLanguage,
    priceDzd: c.priceDzd,
    premiumPriceDzd: discounted(c.priceDzd, premiumRate),
    includedInPass: c.includedInPass,
    thumbnailUrl: c.thumbnailUrl,
    durationSec: lessons.reduce((s, l) => s + l.durationSec, 0),
    lessonCount: lessons.length,
    comingSoonModules: c.modules.filter((m) => isVisibleModule(m) && m.comingSoon).length,
    mentors: c.mentorIds
      .map((id) => mentors.find((m) => m.id === id))
      .filter((m): m is MentorRecord => Boolean(m))
      .map(mentorChip),
    publishedAt: c.publishedAt,
  };
}

function toDetail(c: AcademyCourseRecord, locale: string, mentors: MentorRecord[], premiumRate: number): PublicCourseDetail {
  return {
    ...toCard(c, locale, mentors, premiumRate),
    description: resolveText(c.description, locale),
    outcomes: c.outcomes.map((o) => resolveText(o, locale)).filter(Boolean),
    modules: c.modules.filter(isVisibleModule).map((m) => ({
      id: m.id,
      title: resolveText(m.title, locale),
      comingSoon: m.comingSoon,
      // A module announced as "coming soon" lists its planned lessons without lengths.
      durationSec: m.comingSoon ? 0 : m.lessons.reduce((s, l) => s + l.durationSec, 0),
      lessons: m.lessons.map((l) => ({
        id: l.id,
        title: resolveText(l.title, locale),
        durationSec: m.comingSoon ? 0 : l.durationSec,
        isPreview: !m.comingSoon && l.isPreview,
      })),
    })),
  };
}

export const CATALOG_SORTS = ['newest', 'price-asc', 'price-desc', 'shortest'] as const;
export type CatalogSort = (typeof CATALOG_SORTS)[number];

export interface CatalogFilters {
  fieldId?: string | null;
  level?: AcademyLevel | null;
  audioLanguage?: AcademyAudioLanguage | null;
  inPass?: boolean;
  q?: string | null;
  sort?: CatalogSort;
}

function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** Published courses as cards, filtered and sorted. Search matches titles in every language. */
export async function listPublicCourses(locale: string, filters: CatalogFilters = {}): Promise<PublicCourseCard[]> {
  const [d, pricing] = await Promise.all([db.read(), getAcademyPricing()]);
  const q = filters.q ? fold(filters.q.trim()).slice(0, 80) : '';
  const courses = (d.academyCourses ?? []).filter((c) => {
    if (c.status !== 'PUBLISHED') return false;
    if (filters.fieldId && c.fieldId !== filters.fieldId) return false;
    if (filters.level && c.level !== filters.level) return false;
    if (filters.audioLanguage && c.audioLanguage !== filters.audioLanguage) return false;
    if (filters.inPass && !c.includedInPass) return false;
    if (q) {
      const hay = [c.title, c.subtitle].flatMap((t) => (t ? locales.map((l) => t[l] ?? '') : [])).join(' ');
      if (!fold(hay).includes(q)) return false;
    }
    return true;
  });
  const cards = courses.map((c) => toCard(c, locale, d.mentors, pricing.premiumDiscountRate));
  const sort = filters.sort ?? 'newest';
  cards.sort((a, b) => {
    if (sort === 'price-asc') return a.priceDzd - b.priceDzd;
    if (sort === 'price-desc') return b.priceDzd - a.priceDzd;
    if (sort === 'shortest') return a.durationSec - b.durationSec;
    return (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '');
  });
  return cards;
}

export async function getPublicCourse(slug: string, locale: string): Promise<PublicCourseDetail | null> {
  const [d, pricing] = await Promise.all([db.read(), getAcademyPricing()]);
  const c = (d.academyCourses ?? []).find((x) => x.slug === slug && x.status === 'PUBLISHED');
  return c ? toDetail(c, locale, d.mentors, pricing.premiumDiscountRate) : null;
}

export interface PublicAcademyMentor extends PublicMentorChip {
  bio: string | null;
  city: string | null;
  linkedinUrl: string | null;
  /** True when the mentor also takes paid consultations on Metwork. */
  bookable: boolean;
  courses: PublicCourseCard[];
}

/**
 * A mentor's Academy profile: shown only while they are approved AND have at
 * least one published course, so a mentor's draft never creates a public page.
 */
export async function getPublicMentor(slug: string, locale: string): Promise<PublicAcademyMentor | null> {
  const [d, pricing] = await Promise.all([db.read(), getAcademyPricing()]);
  const m = d.mentors.find((x) => mentorSlug(x) === slug);
  if (!m || !isMentorApproved(m)) return null;
  const courses = (d.academyCourses ?? [])
    .filter((c) => c.status === 'PUBLISHED' && c.mentorIds.includes(m.id))
    .map((c) => toCard(c, locale, d.mentors, pricing.premiumDiscountRate));
  if (!courses.length) return null;
  return {
    ...mentorChip(m),
    bio: m.bio,
    city: m.city ?? null,
    linkedinUrl: m.linkedinUrl,
    bookable: isMentorPubliclyListed(m),
    courses,
  };
}

/** Slugs for the sitemap / static params. */
export async function listPublishedSlugs(): Promise<string[]> {
  return ((await db.read()).academyCourses ?? []).filter((c) => c.status === 'PUBLISHED').map((c) => c.slug);
}

