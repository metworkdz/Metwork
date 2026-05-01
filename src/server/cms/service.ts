import { db } from '@/server/db/store';
import { defaultLandingContent } from './defaults';
import type { LandingContent } from '@/types/cms';
import type { LandingContentInput } from './schemas';

/**
 * Returns the current landing content. Falls back to hard-coded defaults
 * if the admin has never saved anything.
 */
export async function getLandingContent(): Promise<LandingContent> {
  const data = await db.read();
  if (data.landingContent) return data.landingContent;
  return { ...defaultLandingContent, updatedAt: new Date(0).toISOString() };
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
