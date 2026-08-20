/**
 * User roles in the Metwork platform.
 * These map 1:1 with the `role` enum in the Prisma schema.
 *
 * History: `TRAINER` was replaced by `BUSINESS` (trainers, training centres
 * and companies via a `businessSubType` discriminator), then `BUSINESS` was
 * itself retired and merged into `INCUBATOR` (via `IncubatorRecord.businessType`
 * — see `INCUBATOR_BUSINESS_TYPES` below). Both legacy literals are migrated
 * to `INCUBATOR` on read (see store.load() → applyOneTimeMigrations()), so
 * neither appears in this union — every persisted record has been rewritten.
 */
export const USER_ROLES = ['ENTREPRENEUR', 'INVESTOR', 'INCUBATOR', 'ADMIN'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/**
 * Roles a user can self-select at signup.
 * ADMIN is provisioned manually only.
 *
 * `BUSINESS` was removed here by the Business→Incubator merge: trainers and
 * training centres now sign up as `INCUBATOR` and pick an
 * `IncubatorBusinessType` instead. The literal stays in `USER_ROLES` above so
 * any record written before the merge still types/reads correctly.
 */
export const SIGNUP_ROLES = ['ENTREPRENEUR', 'INVESTOR', 'INCUBATOR'] as const;
export type SignupRole = (typeof SIGNUP_ROLES)[number];

/**
 * Sub-type chosen when a user signed up as BUSINESS (single select).
 * LEGACY — no longer collected at signup (see SIGNUP_ROLES). Retained because
 * pre-merge `UserRecord`s still carry it and the admin approvals UI displays it.
 * Superseded by `IncubatorBusinessType` below.
 */
export const BUSINESS_SUB_TYPES = ['TRAINER', 'TRAINING_CENTER', 'COMPANY'] as const;
export type BusinessSubType = (typeof BUSINESS_SUB_TYPES)[number];

/**
 * Account-level provider category, stored on `IncubatorRecord.businessType`.
 *
 * Purely INFORMATIONAL — it never gates permissions: an INCUBATOR, a
 * COWORKING_SPACE and a TRAINING_CENTER all have byte-for-byte identical
 * capabilities. It only drives user-facing labelling.
 *
 * NOT to be confused with `SpaceCategory` (@/types/domain — COWORKING /
 * PRIVATE_OFFICE / TRAINING_ROOM / DOMICILIATION), which classifies an
 * individual bookable space listing rather than the account that owns it.
 * A TRAINING_CENTER account may list COWORKING spaces, and vice versa.
 *
 * Declared here (not in `@/server/db/store`) so client components can import
 * the values without pulling the server-only store module into the bundle.
 */
export const INCUBATOR_BUSINESS_TYPES = ['INCUBATOR', 'COWORKING_SPACE', 'TRAINING_CENTER'] as const;
export type IncubatorBusinessType = (typeof INCUBATOR_BUSINESS_TYPES)[number];

/**
 * Account approval gate (read-only-until-approved). Entrepreneurs and admins are
 * always APPROVED; INCUBATOR / INVESTOR accounts land PENDING and must
 * be approved by an admin before they can perform any write/transaction action.
 * Legacy records lacking the field are grandfathered as APPROVED.
 */
export const APPROVAL_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

/** Roles that are subject to the admin approval gate. */
export const APPROVAL_GATED_ROLES = ['INCUBATOR', 'INVESTOR'] as const;

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
  /** LEGACY business sub-type — set only on accounts created before the BUSINESS role was merged into INCUBATOR. */
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
  /**
   * Membership discount rates locked in at purchase (0–1). Present so client
   * price previews use the member's ACTUAL frozen rates instead of re-deriving
   * them from the tier — a later admin change must not move an active member's
   * displayed price. Absent ⇒ the client shows no tier discount.
   */
  membershipSpaceDiscountRate?: number;
  membershipConsultationDiscountRate?: number;
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
