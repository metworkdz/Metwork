/**
 * Shared contract-template helpers used by both the CRUD/generation API routes
 * and the bookings views — single source of truth for "which templates apply to
 * this space booking", so the read path (UI picker) and the write path
 * (generation endpoint) never disagree.
 */
import type { ContractTemplateRecord, IncubatorRecord } from '@/server/db/store';
import type { SpaceCategory } from '@/types/domain';
import { findIncubatorByUserEmail } from '@/server/incubator/service';
import { getOrCreateAdminIncubator } from '@/lib/admin-incubator';

/**
 * Resolve the incubator that owns contract templates for the calling user.
 * INCUBATOR → their linked profile; ADMIN → the admin-as-incubator profile
 * (auto-created on first use). Returns null when an INCUBATOR has no profile.
 */
export async function resolveContractIncubator(
  user: { id: string; email: string; role: string },
): Promise<IncubatorRecord | null> {
  if (user.role === 'ADMIN') return getOrCreateAdminIncubator(user.id);
  return findIncubatorByUserEmail(user.email);
}

/**
 * A template applies to a space when it targets that space's category or is the
 * 'ANY' wildcard (or has no category set — legacy/unscoped templates).
 */
export function templateAppliesToCategory(
  template: Pick<ContractTemplateRecord, 'spaceCategory'>,
  category: SpaceCategory | null,
): boolean {
  const target = template.spaceCategory ?? 'ANY';
  if (target === 'ANY') return true;
  return category != null && target === category;
}

/** All of an incubator's templates that apply to the given space category. */
export function applicableTemplates(
  templates: ContractTemplateRecord[],
  category: SpaceCategory | null,
): ContractTemplateRecord[] {
  return templates.filter((t) => templateAppliesToCategory(t, category));
}
