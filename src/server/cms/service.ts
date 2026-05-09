import { db } from '@/server/db/store';
import type { LandingContent } from '@/types/cms';
import type { LandingContentInput } from './schemas';

/**
 * Returns admin-saved landing content, or null if the admin has never
 * published anything. Callers (the landing page server component) should
 * fall back to locale-specific translation strings when null is returned.
 */
export async function getLandingContent(): Promise<LandingContent | null> {
  const data = await db.read();
  return data.landingContent ?? null;
}

/**
 * Overwrites the landing content with the validated payload and persists.
 * Called by the admin API route.
 */
export async function updateLandingContent(
  input: LandingContentInput,
): Promise<LandingContent> {
  const now = new Date().toISOString();
  const record: LandingContent = { ...input, updatedAt: now };
  await db.update((d) => {
    d.landingContent = record;
  });
  return record;
}
