/**
 * User roles in the Metwork platform.
 * These map 1:1 with the `role` enum in the Prisma schema.
 *
 * `BUSINESS` replaces the former `TRAINER` role: it now covers trainers,
 * training centres, and companies via a `businessSubType` discriminator.
 * Legacy `TRAINER` records are migrated to `BUSINESS` on read (see store.load()).
 */
export const USER_ROLES = ['ENTREPRENEUR', 'INVESTOR', 'INCUBATOR', 'BUSINESS', 'ADMIN'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/**
 * Roles a user can self-select at signup.
 * ADMIN is provisioned manually only.
 */
export const SIGNUP_ROLES = ['ENTREPRENEUR', 'INVESTOR', 'INCUBATOR', 'BUSINESS'] as const;
export type SignupRole = (typeof SIGNUP_ROLES)[number];

/** Sub-type chosen when a user signs up as BUSINESS (single select). */
export const BUSINESS_SUB_TYPES = ['TRAINER', 'TRAINING_CENTER', 'COMPANY'] as const;
export type BusinessSubType = (typeof BUSINESS_SUB_TYPES)[number];

/**
 * Account approval gate (read-only-until-approved). Entrepreneurs and admins are
 * always APPROVED; INCUBATOR / INVESTOR / BUSINESS accounts land PENDING and must
 * be approved by an admin before they can perform any write/transaction action.
 * Legacy records lacking the field are grandfathered as APPROVED.
 */
export const APPROVAL_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

/** Roles that are subject to the admin approval gate. */
export const APPROVAL_GATED_ROLES = ['INCUBATOR', 'INVESTOR', 'BUSINESS'] as const;

export type UserStatus = 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED' | 'BANNED';

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  phone: string;
  city: string;
  role: UserRole;
  status: UserStatus;
  /**
   * Admin approval gate. Optional for backward compat with tokens issued before
   * this field existed — absence is treated as APPROVED by the approval guard.
   */
  approvalStatus?: ApprovalStatus;
  /** Business sub-type (role === 'BUSINESS' only). */
  businessSubType?: BusinessSubType | null;
  phoneVerified: boolean;
  emailVerified: boolean;
  membershipCode: string | null;
  /** ISO datetime — when the paid membership expires. Null = no expiry or free tier. */
  membershipExpiresAt?: string | null;
  /** Membership code the user has scheduled to switch to at `scheduledChangeDate`. */
  scheduledMembershipChange?: string | null;
  /** ISO datetime — when the scheduled downgrade takes effect. */
  scheduledChangeDate?: string | null;
  avatarUrl: string | null;
  locale: 'en' | 'fr' | 'ar';

  // ── Network Pass / tier fields (populated from UserRecord; optional for
  //    backward compat with tokens issued before these fields were added) ──

  /** Resolved tier: 'EXPLORER' | 'BUILDER' | 'FOUNDER'. Defaults to 'EXPLORER'. */
  membershipTier?: 'EXPLORER' | 'BUILDER' | 'FOUNDER';
  /** ISO datetime when the current membership started. */
  membershipStartDate?: string | null;
  /** Network pass credits remaining this billing cycle. */
  networkCredits?: number;
  /** Monthly allowance for this tier. */
  networkCreditsMax?: number;
  /** ISO datetime — next reset date (1st of next month UTC). */
  networkCreditsResetDate?: string | null;
}

export interface Session {
  user: SessionUser;
  expiresAt: Date;
}
