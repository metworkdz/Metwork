/**
 * Startup Academy course certificates.
 *
 * Owner rule (2026-11-01): every released lesson watched to 90 % — counted
 * from server-side watch time, so neither the "mark as done" button nor a seek
 * to the end is enough — and every module quiz passed at 70 %. Buyers and Pass
 * learners both earn one (decision 8). Once issued, a buyer can no longer be
 * refunded (decision 5).
 *
 * The certificate is claimed by the learner, issued once, and frozen: its
 * number, name and course title never change, and it stays valid when the
 * course gains modules or the Pass ends. Only an admin revokes it.
 *
 * Drawn with the participation-certificate renderer (server/certificates),
 * with the Metwork stamp from the Academy settings.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { db, type AcademyCertificateRecord, type AcademyCourseRecord } from '@/server/db/store';
import { resolveText } from '@/lib/localized-text';
import { isLessonWatched, isLiveModule } from '@/lib/academy';
import { academyRepo } from './repo';
import { courseReach, type Viewer } from './access';

type StoreData = Awaited<ReturnType<typeof db.read>>;

export interface CertificateProgress {
  lessonsTotal: number;
  lessonsDone: number;
  quizzesTotal: number;
  quizzesPassed: number;
  eligible: boolean;
}

/** What counts: released lessons with a video, and the quizzes of released modules. */
function requirements(course: AcademyCourseRecord) {
  const live = course.modules.filter(isLiveModule);
  return {
    lessons: live.flatMap((m) => m.lessons).filter((l) => l.videoStatus === 'READY' && l.durationSec > 0),
    quizModules: live.filter((m) => (m.quiz?.questions.length ?? 0) > 0),
  };
}

export async function certificateProgress(userId: string, course: AcademyCourseRecord, d: StoreData): Promise<CertificateProgress> {
  const { lessons, quizModules } = requirements(course);
  const repo = academyRepo();
  const [progress, watched] = await Promise.all([repo.progressFor(userId, course.id), repo.lessonWatchSeconds(userId, course.id)]);
  const completed = new Set(progress.filter((p) => p.completedAt).map((p) => p.lessonId));
  const lessonsDone = lessons.filter((l) => completed.has(l.id) && isLessonWatched(watched[l.id] ?? 0, l.durationSec)).length;
  const passed = new Set((d.academyQuizResults ?? [])
    .filter((r) => r.userId === userId && r.courseId === course.id && r.passedAt).map((r) => r.moduleId));
  const quizzesPassed = quizModules.filter((m) => passed.has(m.id)).length;
  return {
    lessonsTotal: lessons.length,
    lessonsDone,
    quizzesTotal: quizModules.length,
    quizzesPassed,
    eligible: lessons.length > 0 && lessonsDone === lessons.length && quizzesPassed === quizModules.length,
  };
}

export function activeCertificate(d: StoreData, userId: string, courseId: string): AcademyCertificateRecord | null {
  return (d.academyCertificates ?? []).find((c) => c.userId === userId && c.courseId === courseId && !c.revokedAt) ?? null;
}

/** The next "ACA-2026-0001" of the year — one sequence for the whole Academy. */
function nextNumber(d: StoreData, year: number): string {
  const prefix = `ACA-${year}-`;
  let max = 0;
  for (const c of d.academyCertificates ?? []) {
    if (!c.number.startsWith(prefix)) continue;
    const n = Number(c.number.slice(prefix.length));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

function mentorNamesOf(d: StoreData, course: AcademyCourseRecord): string {
  return course.mentorIds.map((id) => d.mentors.find((m) => m.id === id)?.fullName).filter(Boolean).join(', ');
}

export type ClaimError = 'NOT_FOUND' | 'LOCKED' | 'NOT_ELIGIBLE' | 'NAME_MISSING';

export type ClaimResult =
  | { ok: true; certificate: AcademyCertificateRecord; created: boolean }
  | { ok: false; code: ClaimError; progress?: CertificateProgress };

/**
 * Issue the learner's certificate, or return the one they already have.
 * Admins reviewing a course never get one (their access is not a learner's).
 */
export async function claimCertificate(viewer: Viewer, courseId: string): Promise<ClaimResult> {
  const reach = await courseReach(viewer, courseId);
  if (!reach.ok) return { ok: false, code: 'NOT_FOUND' };
  const existing = activeCertificate(reach.d, viewer.id, courseId);
  if (existing) return { ok: true, certificate: existing, created: false };
  if (reach.access !== 'OWNED' && reach.access !== 'PASS') return { ok: false, code: 'LOCKED' };
  const access = reach.access;

  const progress = await certificateProgress(viewer.id, reach.course, reach.d);
  if (!progress.eligible) return { ok: false, code: 'NOT_ELIGIBLE', progress };
  const user = reach.d.users.find((u) => u.id === viewer.id);
  const fullName = user?.fullName?.trim() ?? '';
  if (!fullName) return { ok: false, code: 'NAME_MISSING' };

  const now = new Date();
  const res = await db.update((d) => {
    if (!Array.isArray(d.academyCertificates)) d.academyCertificates = [];
    // Two clicks at once: the second finds the first one's certificate.
    const again = activeCertificate(d, viewer.id, courseId);
    if (again) return { certificate: again, created: false };
    const course = d.academyCourses?.find((c) => c.id === courseId);
    if (!course) return null;
    const cert: AcademyCertificateRecord = {
      id: randomUUID(),
      number: nextNumber(d, now.getUTCFullYear()),
      verifyToken: randomBytes(18).toString('base64url'),
      userId: viewer.id,
      courseId,
      fullName,
      // French, like Metwork's other certificates; the source language when there is no French title.
      courseTitle: resolveText(course.title, 'fr'),
      mentorNames: mentorNamesOf(d, course),
      access,
      issuedAt: now.toISOString(),
      emailedAt: null,
      revokedAt: null,
    };
    d.academyCertificates.push(cert);
    return { certificate: cert, created: true };
  });
  if (!res) return { ok: false, code: 'NOT_FOUND' };
  return { ok: true, ...res };
}

/** The learner's certificates, newest first. */
export async function listMyCertificates(userId: string): Promise<AcademyCertificateRecord[]> {
  const d = await db.read();
  return (d.academyCertificates ?? []).filter((c) => c.userId === userId && !c.revokedAt)
    .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
}

/** Admin: revoke or restore. The number stays the same either way. */
export async function setCertificateRevoked(certificateId: string, revoked: boolean): Promise<boolean> {
  return db.update((d) => {
    const c = d.academyCertificates?.find((x) => x.id === certificateId);
    if (!c) return false;
    c.revokedAt = revoked ? (c.revokedAt ?? new Date().toISOString()) : null;
    return true;
  });
}

export function academyCertificateVerifyUrl(token: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://metwork.dz').replace(/\/+$/, '');
  return `${base}/attestation/${token}`;
}

/** One-page PDF of a certificate. Imported lazily by its route: pdfkit stays out of other bundles. */
export async function renderAcademyCertificatePdf(cert: AcademyCertificateRecord): Promise<Buffer> {
  const [{ renderCertificatesPdf }, { DEFAULT_CERTIFICATE_SETTINGS }, { fetchCertificateImage }, { loadBrandLogo }, { getAcademySettings }] = await Promise.all([
    import('@/server/certificates/render'),
    import('@/server/certificates/types'),
    import('@/server/certificates/images'),
    import('@/server/pdf/contract-layout'),
    import('./settings'),
  ]);
  const settings = await getAcademySettings();
  const stamp = await fetchCertificateImage(settings.certificateStampUrl);
  return renderCertificatesPdf({
    settings: {
      ...DEFAULT_CERTIFICATE_SETTINGS,
      title: 'CERTIFICAT',
      subtitle: 'DE RÉUSSITE',
      intro: 'Metwork Startup Academy certifie que',
      body: 'A suivi avec succès l’intégralité du cours « {programme} »[[, animé par {formateur}]], '
        + 'et réussi ses évaluations. Délivré le **{date}**.',
      trainerName: cert.mentorNames || null,
      signatories: [{ name: 'Metwork', role: 'Startup Academy', imageUrl: null }],
      showStamp: Boolean(stamp),
      showVerification: true,
    },
    context: { programTitle: cert.courseTitle, organizer: 'Metwork Startup Academy', city: '', startDate: cert.issuedAt, endDate: cert.issuedAt },
    recipients: [{ fullName: cert.fullName, number: cert.number, verifyUrl: academyCertificateVerifyUrl(cert.verifyToken) }],
    mode: 'DIGITAL',
    images: { logo: loadBrandLogo(), stamp, signatures: [] },
  });
}
