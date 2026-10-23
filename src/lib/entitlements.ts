/**
 * Plan entitlements — what Free and paid members may use, per audience.
 *
 * THE limit table for Metwork 2.0 features. Every later phase asks this module
 * ("may this user create another invoice?") instead of comparing plan codes,
 * so the Free/paid split is changed in one place. Discount rates are NOT here:
 * they are frozen per membership and resolved by `resolveMemberBenefits`.
 *
 * `null` means unlimited. Client-safe (no server imports), so a page can grey
 * out a button with the same answer the API enforces.
 */
import { PLAN_AUDIENCE, normalizePlanCode } from '@/lib/membership-benefits';
import type { UserRole } from '@/types/auth';

export type Audience = 'ENTREPRENEUR' | 'FREELANCER';

/** Shared business-admin limits. */
interface BusinessAdminLimits {
  invoicesPerMonth: number | null;
  clients: number | null;
  activePaymentLinks: number | null;
  /** Metwork's fee on a payment link, % of the amount (gateway fees are separate). */
  paymentLinkFeePercent: number;
  contractsPerMonth: number | null;
  /** Logo + stamp on invoices, devis and contracts. */
  brandedDocuments: boolean;
  copilotQuestionsPerMonth: number | null;
  /** Tax tasks show amounts prefilled from paid invoices. */
  prefilledTaxAmounts: boolean;
  newContactsPerWeek: number | null;
  /** Access to the partner perks reserved for members. */
  exclusivePerks: boolean;
}

export interface EntrepreneurEntitlements extends BusinessAdminLimits {
  audience: 'ENTREPRENEUR';
  ventures: number;
  publicStartupPage: boolean;
  fundraisingMode: boolean;
  cofounderCardsPerDay: number;
  /** Chat opens on a mutual match. Likes never reveal who sent them, on any plan. */
  cofounderChat: boolean;
  quoteRequestsPerMonth: number | null;
}

export interface FreelancerEntitlements extends BusinessAdminLimits {
  audience: 'FREELANCER';
  gigs: number | null;
  /** Ranked ahead of Free profiles of similar quality in search and AI matches. */
  searchPriority: boolean;
  /** Metwork's commission on work found through Metwork, %. */
  sourcedCommissionPercent: number;
  cofounderCardsPerDay: number;
}

export type Entitlements = EntrepreneurEntitlements | FreelancerEntitlements;

const FREE_ADMIN: BusinessAdminLimits = {
  invoicesPerMonth: 5,
  clients: 10,
  activePaymentLinks: 2,
  paymentLinkFeePercent: 3,
  contractsPerMonth: 1,
  brandedDocuments: false,
  copilotQuestionsPerMonth: 15,
  prefilledTaxAmounts: false,
  newContactsPerWeek: 10,
  exclusivePerks: false,
};

const PAID_ADMIN: BusinessAdminLimits = {
  invoicesPerMonth: null,
  clients: null,
  activePaymentLinks: null,
  paymentLinkFeePercent: 0,
  contractsPerMonth: null,
  brandedDocuments: true,
  copilotQuestionsPerMonth: null,
  prefilledTaxAmounts: true,
  newContactsPerWeek: null,
  exclusivePerks: true,
};

const TABLE = {
  ENTREPRENEUR: {
    free: {
      ...FREE_ADMIN,
      audience: 'ENTREPRENEUR',
      ventures: 1,
      publicStartupPage: false,
      fundraisingMode: false,
      cofounderCardsPerDay: 3,
      cofounderChat: false,
      quoteRequestsPerMonth: 3,
    },
    paid: {
      ...PAID_ADMIN,
      audience: 'ENTREPRENEUR',
      ventures: 1,
      publicStartupPage: true,
      fundraisingMode: true,
      cofounderCardsPerDay: 30,
      cofounderChat: true,
      quoteRequestsPerMonth: null,
    },
  },
  FREELANCER: {
    free: {
      ...FREE_ADMIN,
      audience: 'FREELANCER',
      gigs: 2,
      searchPriority: false,
      sourcedCommissionPercent: 10,
      cofounderCardsPerDay: 3,
    },
    paid: {
      ...PAID_ADMIN,
      audience: 'FREELANCER',
      gigs: null,
      searchPriority: true,
      sourcedCommissionPercent: 7,
      cofounderCardsPerDay: 30,
    },
  },
} as const satisfies {
  ENTREPRENEUR: { free: EntrepreneurEntitlements; paid: EntrepreneurEntitlements };
  FREELANCER: { free: FreelancerEntitlements; paid: FreelancerEntitlements };
};

export function entitlementsFor(audience: 'ENTREPRENEUR', paid: boolean): EntrepreneurEntitlements;
export function entitlementsFor(audience: 'FREELANCER', paid: boolean): FreelancerEntitlements;
export function entitlementsFor(audience: Audience, paid: boolean): Entitlements;
export function entitlementsFor(audience: Audience, paid: boolean): Entitlements {
  return TABLE[audience][paid ? 'paid' : 'free'];
}

/** Minimal user shape. Satisfied by SessionUser and UserRecord. */
export interface EntitlementUser {
  role: UserRole;
  membershipCode?: string | null;
  membershipTier?: string | null;
  membershipExpiresAt?: string | null;
}

export function audienceForRole(role: UserRole): Audience | null {
  return role === 'ENTREPRENEUR' || role === 'FREELANCER' ? role : null;
}

/**
 * True when the user holds an unexpired paid plan made for their audience.
 * The retired Entrepreneur plan still counts for entrepreneurs until it
 * expires; a plan of the other audience (e.g. an admin mistake) never does.
 */
export function hasPaidPlanForAudience(user: EntitlementUser, now = new Date()): boolean {
  const audience = audienceForRole(user.role);
  if (!audience) return false;
  if (user.membershipExpiresAt && new Date(user.membershipExpiresAt) <= now) return false;
  const plan = normalizePlanCode(user.membershipCode) ?? normalizePlanCode(user.membershipTier);
  return plan !== null && PLAN_AUDIENCE[plan] === audience;
}

/** Entitlements for a user, or null for roles these features don't apply to. */
export function entitlementsForUser(user: EntitlementUser, now = new Date()): Entitlements | null {
  const audience = audienceForRole(user.role);
  if (!audience) return null;
  return entitlementsFor(audience, hasPaidPlanForAudience(user, now));
}

/** True while `used` is below `limit` (null = unlimited). */
export function withinLimit(limit: number | null, used: number): boolean {
  return limit === null || used < limit;
}
