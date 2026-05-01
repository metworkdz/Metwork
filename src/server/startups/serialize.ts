import type { StartupListingRecord } from '@/server/db/store';
import type { StartupListing } from '@/types/startup';

export function toStartupDto(r: StartupListingRecord): StartupListing {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    industry: r.industry,
    fundingGoal: r.fundingGoal,
    equityOffered: r.equityOffered,
    valuation: r.valuation,
    founderId: r.founderId,
    status: r.status,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}
