/**
 * Startup Academy phase 4 — the mentor Studio: ownership and edit modes, the
 * signed addendum gate, adding modules to a published course (hidden from
 * learners until the admin approves them), and the admin review answers.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { db, type AcademyCourseRecord, type ConsultantContractRecord } from '@/server/db/store';
import {
  createMentorCourse, deleteMentorCourse, editModeFor, getStudioOverview, listReviewQueue, mentorLessonUpload,
  reviewCourse, saveMentorCourse, submitMentorCourse,
} from '@/server/academy/studio';
import { addendumStateOf, prepareAcademyAddendum } from '@/server/academy/addendum';
import { getPublicCourse, type CourseDraftInput } from '@/server/academy/catalog';
import { lessonAccess } from '@/server/academy/access';
import { createMemoryAcademyRepo, setAcademyRepoForTests } from '@/server/academy/repo';
import { toConsultantContractDto } from '@/server/consultant-contracts/dto';

const NOW = '2026-11-01T10:00:00.000Z';
const THUMB = 'https://res.cloudinary.com/demo/image/upload/v1/metwork/academy/c.jpg';
const repo = createMemoryAcademyRepo();

const lesson = (id: string, extra: Record<string, unknown> = {}) => ({
  id, title: { source: 'fr', fr: id }, description: null, kind: 'VIDEO', videoId: 'a'.repeat(32), videoStatus: 'READY', durationSec: 600, isPreview: false, resources: [], ...extra,
});
function course(id: string, extra: Partial<AcademyCourseRecord> = {}): AcademyCourseRecord {
  return {
    id, slug: id, fieldId: 'ideation', mentorIds: ['m-1'], title: { source: 'fr', fr: id }, subtitle: null, description: { source: 'fr', fr: 'd' },
    outcomes: [], level: 'BEGINNER', audioLanguage: 'DARIJA_FR', priceDzd: 2900, includedInPass: true, thumbnailUrl: THUMB, trailerVideoId: null,
    status: 'DRAFT', createdBy: { kind: 'MENTOR', id: 'm-1' }, reviewNote: null, submittedAt: null, publishedAt: null, createdAt: NOW, updatedAt: NOW,
    modules: [{ id: `${id}-m1`, title: { source: 'fr', fr: 'M1' }, comingSoon: false, lessons: [lesson(`${id}-l1`)] }],
    ...extra,
  } as AcademyCourseRecord;
}
function addendum(mentorId: string, status: ConsultantContractRecord['status']): ConsultantContractRecord {
  return { id: `ct-${mentorId}-${status}`, consultantId: mentorId, kind: 'ACADEMY_ADDENDUM', status, createdAt: NOW } as ConsultantContractRecord;
}
/** The course as the builder would send it back. */
function asInput(c: AcademyCourseRecord): CourseDraftInput {
  return {
    slug: c.slug, fieldId: c.fieldId, mentorIds: c.mentorIds, title: c.title, subtitle: c.subtitle, description: c.description, outcomes: c.outcomes,
    level: c.level, audioLanguage: c.audioLanguage, priceDzd: c.priceDzd, includedInPass: c.includedInPass, thumbnailUrl: c.thumbnailUrl,
    modules: c.modules.map((m) => ({ id: m.id, title: m.title, comingSoon: m.comingSoon, lessons: m.lessons.map((l) => ({ id: l.id, title: l.title, description: l.description, isPreview: l.isPreview })) })),
  };
}
const stored = (id: string) => db.read().then((d) => d.academyCourses!.find((c) => c.id === id)!);
const sign = (mentorId = 'm-1') => db.update((d) => { d.consultantContracts = [addendum(mentorId, 'SIGNED')]; });

beforeEach(async () => {
  repo.reset();
  setAcademyRepoForTests(repo);
  await db.update((d) => {
    d.users = [{ id: 'admin', role: 'ADMIN', email: 'a@x.dz' } as never, { id: 'u-1', role: 'ENTREPRENEUR', email: 'u@x.dz' } as never];
    d.mentors = [
      { id: 'm-1', fullName: 'Yacine', approvalStatus: 'APPROVED' } as never,
      { id: 'm-2', fullName: 'Nadia', approvalStatus: 'APPROVED' } as never,
    ];
    d.academyCourses = [
      course('c-draft'),
      course('c-live', { status: 'PUBLISHED', publishedAt: NOW, submittedAt: NOW }),
      course('c-admin', { createdBy: { kind: 'ADMIN', id: 'admin' }, status: 'PUBLISHED', publishedAt: NOW }),
      course('c-other', { mentorIds: ['m-2'], createdBy: { kind: 'MENTOR', id: 'm-2' } }),
    ];
    d.academyEnrollments = [];
    d.academySettings = null;
    d.consultantContracts = [];
    d.notifications = [];
    d.mentorLedgerTxns = [];
  });
});

describe('ownership and edit modes', () => {
  it('maps status and authorship to what the mentor may do', async () => {
    const d = await db.read();
    const mode = (id: string) => editModeFor(d.academyCourses!.find((c) => c.id === id)!, 'm-1');
    expect(mode('c-draft')).toBe('FULL');
    expect(mode('c-live')).toBe('ADD_MODULES');
    expect(mode('c-admin')).toBe('READ_ONLY');
    expect(editModeFor({ ...(await stored('c-draft')), status: 'IN_REVIEW' }, 'm-1')).toBe('LOCKED');
    expect(editModeFor({ ...(await stored('c-draft')), status: 'CHANGES_REQUESTED' }, 'm-1')).toBe('FULL');
  });

  it('another mentor’s course does not exist for me; an admin course is read only', async () => {
    const other = await stored('c-other');
    expect(await saveMentorCourse('m-1', 'c-other', asInput(other))).toEqual({ ok: false, code: 'NOT_FOUND' });
    expect(await saveMentorCourse('m-1', 'c-admin', asInput(await stored('c-admin')))).toEqual({ ok: false, code: 'READ_ONLY' });
    expect(await deleteMentorCourse('m-1', 'c-other')).toEqual({ ok: false, code: 'NOT_FOUND' });
    const overview = await getStudioOverview('m-1');
    expect(overview.courses.map((c) => c.id).sort()).toEqual(['c-admin', 'c-draft', 'c-live']);
  });

  it('creates a draft owned by the mentor', async () => {
    const res = await createMentorCourse('m-1', { title: { source: 'fr', fr: 'Pitch' }, fieldId: 'ideation' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toMatchObject({ status: 'DRAFT', mentorIds: ['m-1'], createdBy: { kind: 'MENTOR', id: 'm-1' } });
  });

  it('a draft save cannot change the mentors, the address or the Pass flag', async () => {
    const c = await stored('c-draft');
    const res = await saveMentorCourse('m-1', 'c-draft', { ...asInput(c), mentorIds: ['m-1', 'm-2'], slug: 'stolen-slug', includedInPass: false, priceDzd: 4500 });
    expect(res.ok).toBe(true);
    expect(await stored('c-draft')).toMatchObject({ mentorIds: ['m-1'], slug: 'c-draft', includedInPass: true, priceDzd: 4500 });
  });

  it('only a never-submitted draft can be deleted', async () => {
    expect(await deleteMentorCourse('m-1', 'c-live')).toEqual({ ok: false, code: 'LOCKED' });
    expect(await deleteMentorCourse('m-1', 'c-draft')).toEqual({ ok: true, value: null });
  });
});

describe('the addendum gate', () => {
  it('submitting needs a SIGNED addendum', async () => {
    expect(await submitMentorCourse('m-1', 'c-draft')).toEqual({ ok: false, code: 'ADDENDUM_REQUIRED' });
    await db.update((d) => { d.consultantContracts = [addendum('m-1', 'PENDING_SIGNATURE')]; });
    expect(await submitMentorCourse('m-1', 'c-draft')).toEqual({ ok: false, code: 'ADDENDUM_REQUIRED' });
    // Another mentor's signature, or the main consultant contract, does not count.
    await db.update((d) => { d.consultantContracts = [addendum('m-2', 'SIGNED'), { ...addendum('m-1', 'SIGNED'), id: 'main', kind: 'CONSULTANT' }]; });
    expect(await submitMentorCourse('m-1', 'c-draft')).toEqual({ ok: false, code: 'ADDENDUM_REQUIRED' });
  });

  it('state: signed wins, voided is ignored', () => {
    expect(addendumStateOf([])).toEqual({ state: 'NONE', contractId: null });
    expect(addendumStateOf([addendum('m-1', 'VOIDED')]).state).toBe('NONE');
    expect(addendumStateOf([addendum('m-1', 'DRAFT'), addendum('m-1', 'SIGNED')]).state).toBe('SIGNED');
  });

  it('prepare drafts a contract of kind ACADEMY_ADDENDUM with the share written in, once', async () => {
    await db.update((d) => {
      d.mentors = [{ id: 'm-1', fullName: 'Yacine', approvalStatus: 'APPROVED', phone: '+213770112233', phoneVerified: true, address: 'Oran', idNumber: '1094', academyShareRate: 0.35 } as never];
      d.academySettings = { addendumTemplate: 'Avenant — part mentor {{academy_share}}, Metwork {{academy_metwork_share}}.' } as never;
    });
    const res = await prepareAcademyAddendum('m-1', 'admin');
    expect(res.ok).toBe(true);
    const c = (await db.read()).consultantContracts![0]!;
    expect(c).toMatchObject({ kind: 'ACADEMY_ADDENDUM', status: 'DRAFT' });
    expect(c.contentSnapshot).toBe('Avenant — part mentor 35 %, Metwork 65 %.');
    expect(toConsultantContractDto(c).kind).toBe('ACADEMY_ADDENDUM');
    expect(await prepareAcademyAddendum('m-1', 'admin')).toEqual({ ok: false, code: 'ALREADY_EXISTS' });
  });

  it('prepare refuses an incomplete profile', async () => {
    expect(await prepareAcademyAddendum('m-1', 'admin')).toMatchObject({ ok: false, code: 'INCOMPLETE_CONSULTANT_PROFILE' });
    expect((await db.read()).consultantContracts).toHaveLength(0);
  });
});

describe('submitting a draft', () => {
  it('goes to IN_REVIEW once complete, notifies admins, and locks the course', async () => {
    await sign();
    await db.update((d) => { d.academyCourses!.find((c) => c.id === 'c-draft')!.thumbnailUrl = null; });
    expect(await submitMentorCourse('m-1', 'c-draft')).toMatchObject({ ok: false, code: 'NOT_READY', problems: ['NO_THUMBNAIL'] });
    await db.update((d) => { d.academyCourses!.find((c) => c.id === 'c-draft')!.thumbnailUrl = THUMB; });
    expect(await submitMentorCourse('m-1', 'c-draft')).toMatchObject({ ok: true, value: { status: 'IN_REVIEW' } });
    expect((await db.read()).notifications!.filter((n) => n.userId === 'admin')).toHaveLength(1);
    expect(await saveMentorCourse('m-1', 'c-draft', asInput(await stored('c-draft')))).toEqual({ ok: false, code: 'LOCKED' });
    expect(await mentorLessonUpload('m-1', 'c-draft', 'c-draft-l1')).toEqual({ ok: false, code: 'LOCKED' });
    expect((await listReviewQueue('fr')).map((q) => [q.courseId, q.kind])).toEqual([['c-draft', 'COURSE']]);
  });

  it('the admin can send it back with a note; the mentor edits again', async () => {
    await sign();
    await submitMentorCourse('m-1', 'c-draft');
    expect(await reviewCourse('c-draft', { action: 'REQUEST_CHANGES', note: '  Refaire l’intro  ' })).toMatchObject({ ok: true, value: { status: 'CHANGES_REQUESTED', reviewNote: 'Refaire l’intro' } });
    expect((await saveMentorCourse('m-1', 'c-draft', asInput(await stored('c-draft')))).ok).toBe(true);
    expect(await reviewCourse('c-live', { action: 'REQUEST_CHANGES', note: 'x' })).toEqual({ ok: false, code: 'LOCKED' });
  });
});

describe('adding modules to a published course', () => {
  async function propose() {
    const live = await stored('c-live');
    const input = asInput(live);
    // The mentor also tries to rewrite the live module and the price: ignored.
    input.priceDzd = 9900;
    input.modules[0] = { ...input.modules[0]!, title: { source: 'fr', fr: 'Hacked' } };
    input.modules.push({ title: { source: 'fr', fr: 'M2' }, comingSoon: false, lessons: [{ title: { source: 'fr', fr: 'L2' }, description: null, isPreview: true }] } as never);
    return saveMentorCourse('m-1', 'c-live', input);
  }

  it('keeps the live course exactly as approved and stores the new module as pending', async () => {
    const res = await propose();
    expect(res.ok).toBe(true);
    const c = await stored('c-live');
    expect(c.priceDzd).toBe(2900);
    expect(c.modules[0]).toMatchObject({ id: 'c-live-m1', title: { fr: 'M1' } });
    expect(c.modules[0]!.pendingReview).toBeUndefined();
    expect(c.modules[1]).toMatchObject({ pendingReview: true, title: { fr: 'M2' } });
    expect(c.status).toBe('PUBLISHED');
  });

  it('pending modules are invisible to learners, even a free-preview lesson', async () => {
    await propose();
    const c = await stored('c-live');
    const pendingLesson = c.modules[1]!.lessons[0]!;
    const pub = await getPublicCourse('c-live', 'fr');
    expect(pub!.modules.map((m) => m.title)).toEqual(['M1']);
    const res = await lessonAccess({ id: 'u-1', role: 'ENTREPRENEUR' }, 'c-live', pendingLesson.id);
    expect(res.ok).toBe(false);
  });

  it('uploads go only to pending lessons; submit needs ready videos; approval publishes them', async () => {
    await sign();
    await propose();
    const pendingLesson = (await stored('c-live')).modules[1]!.lessons[0]!;
    expect(await mentorLessonUpload('m-1', 'c-live', 'c-live-l1')).toEqual({ ok: false, code: 'LOCKED' });
    expect((await mentorLessonUpload('m-1', 'c-live', pendingLesson.id)).ok).toBe(true);
    expect(await submitMentorCourse('m-1', 'c-live')).toMatchObject({ ok: false, code: 'NOT_READY' });

    await db.update((d) => { const l = d.academyCourses!.find((c) => c.id === 'c-live')!.modules[1]!.lessons[0]!; l.videoStatus = 'READY'; l.videoId = 'b'.repeat(32); });
    expect((await submitMentorCourse('m-1', 'c-live')).ok).toBe(true);
    expect((await listReviewQueue('fr'))[0]).toMatchObject({ courseId: 'c-live', kind: 'MODULES', pendingModules: 1 });

    expect((await reviewCourse('c-live', { action: 'APPROVE_MODULES' })).ok).toBe(true);
    const c = await stored('c-live');
    expect(c.modules.every((m) => !m.pendingReview)).toBe(true);
    expect(c.modulesSubmittedAt).toBeNull();
    expect((await getPublicCourse('c-live', 'fr'))!.modules).toHaveLength(2);
    expect(await submitMentorCourse('m-1', 'c-live')).toEqual({ ok: false, code: 'NOTHING_TO_SUBMIT' });
  });

  it('rejecting keeps the modules pending with a note, for the mentor to fix', async () => {
    await sign();
    await propose();
    await db.update((d) => { const l = d.academyCourses!.find((c) => c.id === 'c-live')!.modules[1]!.lessons[0]!; l.videoStatus = 'READY'; });
    await submitMentorCourse('m-1', 'c-live');
    expect((await reviewCourse('c-live', { action: 'REJECT_MODULES', note: 'Son trop faible' })).ok).toBe(true);
    const c = await stored('c-live');
    expect(c).toMatchObject({ modulesSubmittedAt: null, reviewNote: 'Son trop faible' });
    expect(c.modules[1]!.pendingReview).toBe(true);
    expect(await listReviewQueue('fr')).toEqual([]);
  });
});
