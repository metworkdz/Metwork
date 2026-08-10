import type { StartupListingRecord } from '@/server/db/store';
import type { StartupListing, PublicStartupListing } from '@/types/startup';

export function toStartupDto(r: StartupListingRecord): StartupListing {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    industry: r.industry,
    fundingGoal: r.fundingGoal,
    equityOffered: r.equityOffered,
    valuation: r.valuation,
    maturityStage: r.maturityStage ?? null,
    pitchDeckUrl: r.pitchDeckUrl ?? null,
    websiteUrl: r.websiteUrl ?? null,
    founderId: r.founderId,
    status: r.status,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

const PUBLIC_TAGLINE_MAX_LENGTH = 140;

/** Truncates to a short teaser — callers must never send the full description publicly. */
function toTagline(description: string, maxLength = PUBLIC_TAGLINE_MAX_LENGTH): string {
  const trimmed = description.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength).trimEnd()}…`;
}

/**
 * Public (unauthenticated / non-investor) view of a listing — see DECISION
 * FLAG 2. Deliberately omits fundingGoal, equityOffered, valuation, the full
 * description, pitchDeckUrl, websiteUrl, and founder identity/contact.
 * `isRaising` is a boolean derived from status/fundingGoal presence only —
 * never the amount itself.
 */
export function toPublicStartupDto(
  r: StartupListingRecord,
  opts: { city?: string | null } = {},
): PublicStartupListing {
  return {
    id: r.id,
    name: r.name,
    industry: r.industry,
    city: opts.city ?? null,
    maturityStage: r.maturityStage ?? null,
    tagline: toTagline(r.description),
    isRaising: r.status === 'ACTIVE' && r.fundingGoal != null,
  };
}
