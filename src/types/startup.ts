import type { StartupListingStatus, StartupMaturityStage } from '@/server/db/store';

export type { StartupMaturityStage };

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
  /** Null until the founder chooses one — no default is ever assigned. */
  maturityStage: StartupMaturityStage | null;
  /** URL of the uploaded pitch deck PDF, or null if none uploaded. */
  pitchDeckUrl: string | null;
  /** Optional public website. */
  websiteUrl: string | null;
  /** URL of the uploaded logo, or null if none uploaded. */
  logoUrl: string | null;
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
  maturityStage: StartupMaturityStage;
  websiteUrl?: string | null;
  logoUrl?: string | null;
}

/**
 * Redacted DTO for the public (unauthenticated / non-investor) startup pages.
 * Deliberately omits fundraising economics, the full pitch, pitch deck,
 * website, and founder contact — see DECISION FLAG 2.
 */
export interface PublicStartupListing {
  id: string;
  name: string;
  industry: string;
  /** Founder's city, or null if unavailable. */
  city: string | null;
  /** Null when the founder hasn't chosen a stage yet. */
  maturityStage: StartupMaturityStage | null;
  /** Short teaser derived from the full description — never the full text. */
  tagline: string;
  /** Boolean only — never exposes the funding amount. */
  isRaising: boolean;
  /** URL of the uploaded logo, or null if none uploaded. Not sensitive — safe to expose publicly. */
  logoUrl: string | null;
}
