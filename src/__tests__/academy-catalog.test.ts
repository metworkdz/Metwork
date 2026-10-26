/**
 * Startup Academy phase 1 — admin authoring (create, save, publish, archive,
 * delete), video uploads through the provider, translation drafts, and what
 * the public pages are allowed to see (no video ids, published only).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/server/db/store';
import {
  courseDraftSchema,
  createCourse,
  deleteCourse,
  getPublicCourse,
  getPublicMentor,
  listPublicCourses,
  redactCourseForBuilder,
  saveCourseDraft,
  setCourseStatus,
  type CourseDraftInput,
} from '@/server/academy/catalog';
import { createLessonUpload, refreshByVideoId, refreshLessonVideo } from '@/server/academy/videos';
import { draftCourseTranslations } from '@/server/academy/translate';
import { setVideoProviderForTests } from '@/server/academy/video';
import { createMockVideoProvider } from '@/server/academy/video/mock';
import { localizedText } from '@/lib/localized-text';
import { MODULE1_COURSE } from '@/server/academy/seed/module1';

const ADMIN = { kind: 'ADMIN' as const, id: 'admin-1' };
const mock = createMockVideoProvider();

function mentor(id: string, extra: Record<string, unknown> = {}) {
  return { id, fullName: `Mentor ${id}`, position: 'Coach', imageUrl: '', slug: `mentor-${id}`, bio: 'Bio', linkedinUrl: null, createdAt: '2026-01-01', approvalStatus: 'APPROVED', ...extra } as never;
}

beforeEach(async () => {
  mock.reset();
  setVideoProviderForTests(mock);
  await db.update((d) => {
    d.academyCourses = [];
    d.academyEnrollments = [];
    d.academyFields = [];
    d.academySettings = null;
    d.mentors = [mentor('m-1'), mentor('m-2', { approvalStatus: 'PENDING' })];
  });
});

async function newCourse() {
  const res = await createCourse({ title: localizedText('fr', 'Créer sa SARL'), fieldId: 'legal', mentorIds: ['m-1'] }, ADMIN);
  if (!res.ok) throw new Error(res.code);
  return res.value;
}

function draft(over: Partial<CourseDraftInput> = {}): CourseDraftInput {
  return courseDraftSchema.parse({
    fieldId: 'legal',
    mentorIds: ['m-1'],
    title: { source: 'fr', fr: 'Créer sa SARL', en: 'Set up a SARL' },
    subtitle: null,
    description: { source: 'fr', fr: 'Tout le parcours.' },
    outcomes: [{ source: 'fr', fr: 'Choisir sa forme' }],
    level: 'BEGINNER',
    audioLanguage: 'DARIJA_FR',
    priceDzd: 3900,
    includedInPass: true,
    thumbnailUrl: 'https://res.cloudinary.com/x/cover.jpg',
    modules: [
      { title: { source: 'fr', fr: 'Les bases' }, comingSoon: false, lessons: [{ title: { source: 'fr', fr: 'Intro' }, isPreview: true }, { title: { source: 'fr', fr: 'Le CNRC' } }] },
      { title: { source: 'fr', fr: 'La suite' }, comingSoon: true, lessons: [{ title: { source: 'fr', fr: 'Bientôt' } }] },
    ],
    ...over,
  });
}

async function readyCourse() {
  const c = await newCourse();
  const saved = await saveCourseDraft(c.id, draft());
  if (!saved.ok) throw new Error(saved.code);
  for (const l of saved.value.modules[0]!.lessons) {
    await createLessonUpload(c.id, l.id);
    await refreshLessonVideo(c.id, l.id);
  }
  return c.id;
}

describe('authoring', () => {
  it('opens a draft with a slug from the title and the minimum price', async () => {
    const c = await newCourse();
    expect(c).toMatchObject({ slug: 'creer-sa-sarl', status: 'DRAFT', priceDzd: 2900, includedInPass: true });
    const again = await createCourse({ title: localizedText('fr', 'Créer sa SARL'), fieldId: 'legal', mentorIds: ['m-1'] }, ADMIN);
    expect(again.ok && again.value.slug).toBe('creer-sa-sarl-2');
  });

  it('refuses an unknown field or mentor and a price under 2 900 DA', async () => {
    expect(await createCourse({ title: localizedText('fr', 'X'), fieldId: 'nope', mentorIds: ['m-1'] }, ADMIN)).toEqual({ ok: false, code: 'FIELD_NOT_FOUND' });
    expect(await createCourse({ title: localizedText('fr', 'X'), fieldId: 'legal', mentorIds: ['ghost'] }, ADMIN)).toEqual({ ok: false, code: 'MENTOR_NOT_FOUND' });
    const c = await newCourse();
    expect(await saveCourseDraft(c.id, draft({ priceDzd: 2000 }))).toEqual({ ok: false, code: 'PRICE_BELOW_MINIMUM' });
  });

  it('the builder cannot set or move a video: video fields come from the stored lesson', async () => {
    const id = await readyCourse();
    const before = (await db.read()).academyCourses![0]!.modules[0]!.lessons;
    const payload = draft() as unknown as { modules: { id?: string; lessons: Record<string, unknown>[] }[] };
    const stored = (await db.read()).academyCourses![0]!;
    payload.modules[0]!.id = stored.modules[0]!.id;
    payload.modules[0]!.lessons = stored.modules[0]!.lessons.map((l) => ({ id: l.id, title: l.title, isPreview: false, videoId: 'f'.repeat(32), videoStatus: 'READY' }));
    // Unknown keys are stripped by the schema; the stored video stays.
    const res = await saveCourseDraft(id, courseDraftSchema.parse(payload));
    expect(res.ok).toBe(true);
    const after = (await db.read()).academyCourses![0]!.modules[0]!.lessons;
    expect(after.map((l) => l.videoId)).toEqual(before.map((l) => l.videoId));
    expect(after.every((l) => l.videoStatus === 'READY')).toBe(true);
  });

  it('a lesson id the course does not know gets a fresh id (no hijacking another course)', async () => {
    const a = await readyCourse();
    const otherLessonId = (await db.read()).academyCourses!.find((c) => c.id === a)!.modules[0]!.lessons[0]!.id;
    const b = await createCourse({ title: localizedText('fr', 'Autre'), fieldId: 'legal', mentorIds: ['m-1'] }, ADMIN);
    if (!b.ok) throw new Error();
    const p = draft() as unknown as { modules: { lessons: { id?: string }[] }[] };
    p.modules[0]!.lessons[0]!.id = otherLessonId;
    const saved = await saveCourseDraft(b.value.id, courseDraftSchema.parse(p));
    expect(saved.ok && saved.value.modules[0]!.lessons[0]!.id).not.toBe(otherLessonId);
    expect(saved.ok && saved.value.modules[0]!.lessons[0]!.videoId).toBeNull();
  });

  it('validates text length per language and the cover URL', () => {
    expect(() => draft({ title: { source: 'fr', fr: 'x'.repeat(121) } })).toThrow();
    expect(() => draft({ title: { source: 'fr', fr: 'ok', ar: 'x'.repeat(121) } })).toThrow();
    expect(() => draft({ thumbnailUrl: 'javascript:alert(1)' })).toThrow();
    // Only Cloudinary images: the CSP would block any other host.
    expect(() => draft({ thumbnailUrl: 'https://evil.example/cover.jpg' })).toThrow();
    expect(draft({ thumbnailUrl: '/uploads/academy/a.jpg' }).thumbnailUrl).toBe('/uploads/academy/a.jpg');
  });
});

describe('publishing', () => {
  it('lists what blocks publishing, then publishes once fixed', async () => {
    const c = await newCourse();
    const res = await setCourseStatus(c.id, 'PUBLISH');
    expect(res).toMatchObject({ ok: false, code: 'NOT_READY' });
    expect(!res.ok && res.code === 'NOT_READY' && res.problems).toEqual(expect.arrayContaining(['NO_THUMBNAIL', 'NO_DESCRIPTION', 'NO_RELEASED_LESSON']));

    const id = await readyCourse();
    const ok = await setCourseStatus(id, 'PUBLISH');
    expect(ok.ok && ok.course.status).toBe('PUBLISHED');
  });

  it('a lesson without a ready video, or an unapproved mentor, blocks publishing', async () => {
    const c = await newCourse();
    await saveCourseDraft(c.id, draft());
    const r1 = await setCourseStatus(c.id, 'PUBLISH');
    expect(!r1.ok && r1.code === 'NOT_READY' && r1.problems).toContain('VIDEO_NOT_READY');
    const id = await readyCourse();
    await saveCourseDraft(id, { ...draft(), mentorIds: ['m-1', 'm-2'] });
    const r2 = await setCourseStatus(id, 'PUBLISH');
    expect(!r2.ok && r2.code === 'NOT_READY' && r2.problems).toContain('MENTOR_NOT_APPROVED');
  });

  it('deletes a course nobody bought; one with a buyer must be archived', async () => {
    const id = await readyCourse();
    await db.update((d) => { d.academyEnrollments = [{ id: 'e1', userId: 'u1', courseId: id } as never]; });
    expect(await deleteCourse(id)).toEqual({ ok: false, code: 'HAS_ENROLLMENTS' });
    await db.update((d) => { d.academyEnrollments = []; });
    expect(await deleteCourse(id)).toEqual({ ok: true, value: null });
  });
});

describe('videos', () => {
  it('upload reserves a video on the lesson; refresh stores READY and the length', async () => {
    const c = await newCourse();
    const saved = await saveCourseDraft(c.id, draft());
    const lesson = saved.ok ? saved.value.modules[0]!.lessons[0]! : null;
    const up = await createLessonUpload(c.id, lesson!.id);
    expect(up.ok && up.value).toMatchObject({ url: '/api/academy/mock-upload', fileField: 'file' });
    expect((await db.read()).academyCourses![0]!.modules[0]!.lessons[0]).toMatchObject({ videoStatus: 'UPLOADING' });
    const videoId = (await db.read()).academyCourses![0]!.modules[0]!.lessons[0]!.videoId!;
    expect(await refreshByVideoId(videoId)).toBe(true);
    expect((await db.read()).academyCourses![0]!.modules[0]!.lessons[0]).toMatchObject({ videoStatus: 'READY', durationSec: 90 });
    expect(await refreshByVideoId('0'.repeat(32))).toBe(false);
  });

  it('a lesson whose video is gone from the host is marked FAILED', async () => {
    const c = await newCourse();
    const saved = await saveCourseDraft(c.id, draft());
    const lessonId = saved.ok ? saved.value.modules[0]!.lessons[0]!.id : '';
    await createLessonUpload(c.id, lessonId);
    const videoId = (await db.read()).academyCourses![0]!.modules[0]!.lessons[0]!.videoId!;
    await mock.deleteVideo(videoId);
    expect(await refreshLessonVideo(c.id, lessonId)).toEqual({ ok: true, value: { status: 'FAILED', durationSec: 0 } });
  });
});

describe('what visitors see', () => {
  it('only published courses; titles in the reader language; no video id anywhere', async () => {
    const id = await readyCourse();
    expect(await listPublicCourses('en')).toEqual([]);
    await setCourseStatus(id, 'PUBLISH');

    const [card] = await listPublicCourses('en');
    expect(card).toMatchObject({ title: 'Set up a SARL', priceDzd: 3900, premiumPriceDzd: 3120, lessonCount: 2, durationSec: 180, comingSoonModules: 1 });
    const detail = await getPublicCourse('creer-sa-sarl', 'ar');
    expect(detail?.title).toBe('Créer sa SARL');
    // The announced module lists its lessons, but none is playable.
    expect(detail?.modules[1]).toMatchObject({ comingSoon: true, durationSec: 0 });
    expect(detail?.modules[1]!.lessons.every((l) => !l.isPreview)).toBe(true);

    const videoIds = (await db.read()).academyCourses![0]!.modules.flatMap((m) => m.lessons).map((l) => l.videoId).filter(Boolean) as string[];
    const exposed = JSON.stringify([card, detail, redactCourseForBuilder((await db.read()).academyCourses![0]!)]);
    for (const v of videoIds) expect(exposed).not.toContain(v);
  });

  it('filters by field, pass and level; search matches any language, accents ignored', async () => {
    const id = await readyCourse();
    await setCourseStatus(id, 'PUBLISH');
    expect(await listPublicCourses('fr', { q: 'creer' })).toHaveLength(1);
    expect(await listPublicCourses('fr', { q: 'sarl' })).toHaveLength(1);
    expect(await listPublicCourses('fr', { q: 'pitch' })).toHaveLength(0);
    expect(await listPublicCourses('fr', { fieldId: 'tax' })).toHaveLength(0);
    expect(await listPublicCourses('fr', { level: 'ADVANCED' })).toHaveLength(0);
    expect(await listPublicCourses('fr', { inPass: true })).toHaveLength(1);
  });

  it('archived courses leave the catalogue; a mentor page needs a published course', async () => {
    const id = await readyCourse();
    expect(await getPublicMentor('mentor-m-1', 'fr')).toBeNull();
    await setCourseStatus(id, 'PUBLISH');
    expect((await getPublicMentor('mentor-m-1', 'fr'))?.courses).toHaveLength(1);
    await setCourseStatus(id, 'ARCHIVE');
    expect(await getPublicCourse('creer-sa-sarl', 'fr')).toBeNull();
    expect(await getPublicMentor('mentor-m-1', 'fr')).toBeNull();
  });
});

describe('translation drafts', () => {
  it('fills only missing languages, marks them drafted and never overwrites a person', async () => {
    const id = await readyCourse();
    const seen: string[] = [];
    const res = await draftCourseTranslations(id, async (items) => {
      seen.push(...items.map((i) => i.key));
      return new Map(items.map((i) => [i.key, { en: `EN ${i.text}`, ar: `AR ${i.text}`, fr: 'should be ignored' }]));
    });
    expect(res.ok).toBe(true);
    const c = (await db.read()).academyCourses![0]!;
    expect(c.title).toEqual({ source: 'fr', fr: 'Créer sa SARL', en: 'Set up a SARL', ar: 'AR Créer sa SARL', drafted: ['ar'] });
    expect(c.modules[0]!.lessons[1]!.title).toMatchObject({ en: 'EN Le CNRC', ar: 'AR Le CNRC' });
    expect(seen).toContain('description');
    // Nothing missing any more: the next run does not call the translator.
    let called = false;
    await draftCourseTranslations(id, async () => { called = true; return new Map(); });
    expect(called).toBe(false);
  });

  it('answers for keys we did not send are ignored; a failure changes nothing', async () => {
    const id = await readyCourse();
    const before = JSON.stringify((await db.read()).academyCourses![0]);
    await draftCourseTranslations(id, async () => new Map([['module:other', { en: 'x' }]]));
    expect(JSON.stringify((await db.read()).academyCourses![0]!.modules)).toBe(JSON.stringify(JSON.parse(before).modules));
    expect(await draftCourseTranslations(id, async () => { throw new Error('boom'); })).toEqual({ ok: false, code: 'FAILED' });
  });
});

describe('Module 1 seed data', () => {
  it('has the 7 filmed episodes with valid fr/en/ar titles', () => {
    expect(MODULE1_COURSE.lessons).toHaveLength(7);
    const parsed = courseDraftSchema.parse({
      fieldId: 'ideation', mentorIds: ['m-1'], title: MODULE1_COURSE.title, subtitle: MODULE1_COURSE.subtitle,
      description: MODULE1_COURSE.description, outcomes: [...MODULE1_COURSE.outcomes], level: 'BEGINNER', audioLanguage: 'DARIJA_FR',
      priceDzd: 2900, includedInPass: true, thumbnailUrl: null,
      modules: [{ title: MODULE1_COURSE.moduleTitle, lessons: MODULE1_COURSE.lessons.map((title) => ({ title })) }],
    });
    expect(parsed.modules[0]!.lessons[4]!.title.fr).toBe('Les 3 questions pour valider une idée');
  });
});
