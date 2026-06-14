/**
 * User roles in the Metwork platform.
 * These map 1:1 with the `role` enum in the Prisma schema.
 */
export const USER_ROLES = ['ENTREPRENEUR', 'INVESTOR', 'INCUBATOR', 'TRAINER', 'ADMIN'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/**
 * Roles a user can self-select at signup.
 * ADMIN is provisioned manually only.
 */
export const SIGNUP_ROLES = ['ENTREPRENEUR', 'INVESTOR', 'INCUBATOR', 'TRAINER'] as const;
export type SignupRole = (typeof SIGNUP_ROLES)[number];

export type UserStatus = 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED' | 'BANNED';

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  phone: string;
  city: string;
  role: UserRole;
  status: UserStatus;
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
