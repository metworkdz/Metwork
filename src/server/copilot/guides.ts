/**
 * Business-creation guide progress — one row per user: the guide they chose
 * and the steps they marked done. Read by the guides UI and by the copilot,
 * so a follow-up question knows where the user is.
 */
import { db } from '@/server/db/store';
import {
  GUIDE_STEPS,
  isGuideId,
  nextStep,
  normalizeDone,
  type GuideId,
  type GuideProgressView,
  type StepId,
} from '@/lib/creation-guides';

type DbShape = Awaited<ReturnType<typeof db.read>>;

export function guideProgressOf(data: DbShape, userId: string): GuideProgressView | null {
  const row = data.guideProgress?.find((g) => g.userId === userId);
  if (!row || !isGuideId(row.guide)) return null;
  return { guide: row.guide, done: normalizeDone(row.guide, row.done), updatedAt: row.updatedAt };
}

/**
 * Set the user's guide and done steps. Switching guide keeps the steps the
 * two guides share (a SARL started then switched to EURL loses nothing).
 */
export async function saveGuideProgress(userId: string, guide: GuideId, done: readonly string[]): Promise<GuideProgressView> {
  const clean = normalizeDone(guide, done);
  const now = new Date().toISOString();
  await db.update((d) => {
    if (!d.guideProgress) d.guideProgress = [];
    const row = d.guideProgress.find((g) => g.userId === userId);
    if (row) { row.guide = guide; row.done = clean; row.updatedAt = now; }
    else d.guideProgress.push({ userId, guide, done: clean, updatedAt: now });
  });
  return { guide, done: clean, updatedAt: now };
}

export async function clearGuideProgress(userId: string): Promise<void> {
  await db.update((d) => {
    d.guideProgress = (d.guideProgress ?? []).filter((g) => g.userId !== userId);
  });
}

/** One line for the copilot prompt, in English (the prompt's language). */
export function guideProgressLine(data: DbShape, userId: string): string {
  const p = guideProgressOf(data, userId);
  if (!p) return '';
  const next: StepId | null = nextStep(p.guide, p.done);
  return ` Business-creation guide: ${p.guide}; steps done: ${p.done.join(', ') || 'none'}; next step: ${next ?? 'all done'} (of ${GUIDE_STEPS[p.guide].join(', ')}).`;
}
