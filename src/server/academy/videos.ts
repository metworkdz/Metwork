/**
 * Lesson videos: reserve a direct upload, then follow the host's processing
 * until the lesson is READY (with its real length). The host's video id is
 * written here and nowhere else.
 */
import { db, type AcademyCourseRecord, type AcademyLessonRecord, type AcademyVideoStatus } from '@/server/db/store';
import { resolveText } from '@/lib/localized-text';
import { getVideoProvider, type ProviderVideo } from './video';

export type VideoResult<T> = { ok: true; value: T } | { ok: false; code: 'NOT_FOUND' | 'NO_VIDEO' };

function findLesson(courses: AcademyCourseRecord[] | undefined, courseId: string, lessonId: string): AcademyLessonRecord | null {
  const c = courses?.find((x) => x.id === courseId);
  return c?.modules.flatMap((m) => m.lessons).find((l) => l.id === lessonId) ?? null;
}

/** What the browser needs to send the file straight to the host. */
export interface UploadForm { url: string; fields: Record<string, string>; fileField: string }

/**
 * Reserve an upload for a lesson. A new upload replaces the lesson's video;
 * the old one stays on the host until removed there, so a failed re-upload
 * never leaves a published lesson without its previous recording in storage.
 */
export async function createLessonUpload(courseId: string, lessonId: string): Promise<VideoResult<UploadForm>> {
  const d0 = await db.read();
  const course = d0.academyCourses?.find((c) => c.id === courseId);
  const lesson = findLesson(d0.academyCourses, courseId, lessonId);
  if (!course || !lesson) return { ok: false, code: 'NOT_FOUND' };

  const ticket = await getVideoProvider().createUpload({
    title: `${course.slug} · ${resolveText(lesson.title, 'fr')}`,
  });
  const stored = await db.update((d) => {
    const l = findLesson(d.academyCourses, courseId, lessonId);
    if (!l) return false;
    l.videoId = ticket.videoId;
    l.videoStatus = 'UPLOADING';
    l.durationSec = 0;
    return true;
  });
  if (!stored) return { ok: false, code: 'NOT_FOUND' };
  return { ok: true, value: { url: ticket.url, fields: ticket.fields, fileField: ticket.fileField } };
}

function statusOf(v: ProviderVideo | null): { status: AcademyVideoStatus; durationSec: number | null } {
  if (!v) return { status: 'FAILED', durationSec: null };
  return { status: v.status, durationSec: v.durationSec };
}

/** Ask the host where a lesson's video is, and store the answer. */
export async function refreshLessonVideo(courseId: string, lessonId: string): Promise<VideoResult<{ status: AcademyVideoStatus; durationSec: number }>> {
  const lesson = findLesson((await db.read()).academyCourses, courseId, lessonId);
  if (!lesson) return { ok: false, code: 'NOT_FOUND' };
  if (!lesson.videoId) return { ok: false, code: 'NO_VIDEO' };
  const videoId = lesson.videoId;
  const { status, durationSec } = statusOf(await getVideoProvider().getVideo(videoId));
  const value = await db.update((d) => {
    const l = findLesson(d.academyCourses, courseId, lessonId);
    // A newer upload replaced this video while we were asking: keep the newer state.
    if (!l || l.videoId !== videoId) return null;
    l.videoStatus = status;
    if (durationSec) l.durationSec = durationSec;
    return { status: l.videoStatus, durationSec: l.durationSec };
  });
  return value ? { ok: true, value } : { ok: false, code: 'NOT_FOUND' };
}

/** Webhook entry: refresh whichever lesson holds this video id. Unknown ids are ignored. */
export async function refreshByVideoId(videoId: string): Promise<boolean> {
  for (const c of (await db.read()).academyCourses ?? []) {
    for (const m of c.modules) {
      const l = m.lessons.find((x) => x.videoId === videoId);
      if (l) return (await refreshLessonVideo(c.id, l.id)).ok;
    }
  }
  return false;
}
