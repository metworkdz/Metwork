/**
 * Client-safe label resolution for admin-managed mentor categories. Pure
 * function over an already-fetched record — no DB access, so it's safe to
 * import from client components. Mirrors `getConsultationFieldLabel`, but
 * reads DB-stored labels instead of a static config array.
 */
import type { MentorCategoryRecord } from '@/server/db/store';

export function getMentorCategoryLabel(
  category: Pick<MentorCategoryRecord, 'label'>,
  locale: 'en' | 'fr' | 'ar',
): string {
  return category.label[locale];
}
