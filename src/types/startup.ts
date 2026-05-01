import type { StartupListingStatus } from '@/server/db/store';

/** DTO returned from the API — safe to send to the client. */
export interface StartupListing {
  id: string;
  name: string;
  description: string;
  industry: string;
  /** Integer DZD */
  fundingGoal: number;
  /** e.g. 15.5 = 15.5 % */
  equityOffered: number;
  /** Integer DZD, or null if not disclosed */
  valuation: number | null;
  founderId: string;
  status: StartupListingStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateStartupInput {
  name: string;
  description: string;
  industry: string;
  fundingGoal: number;
  equityOffered: number;
  valuation?: number | null;
}
