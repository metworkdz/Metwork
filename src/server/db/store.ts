/**
 * Supabase-backed JSON store for auth state.
 *
 * All application data is stored as a single JSONB document in the
 * `app_state` table (id = 1). This mirrors the previous file-backed store
 * and keeps all API route code unchanged — only this module changes.
 *
 * In-memory cache and write-queue serialisation are preserved so concurrent
 * requests within the same serverless invocation still coalesce correctly.
 * On cold starts the cache is empty and the first `load()` fetches from
 * Supabase; subsequent calls within the same invocation are cache-hits.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { UserRole, UserStatus } from '@/types/auth';
import type { LandingContent } from '@/types/cms';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Network Pass tier — drives monthly network credit allowance.
 * Mirrors the `membershipCode` taxonomy but kept as an independent field
 * so that pre-existing users (whose `membershipCode` may be null or set to
 * a legacy plan code) still get a deterministic tier on read.
 */
export type MembershipTier = 'EXPLORER' | 'BUILDER' | 'FOUNDER';

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  fullName: string;
  phone: string;
  city: string;
  role: UserRole;
  status: UserStatus;
  phoneVerified: boolean;
  emailVerified: boolean;
  membershipCode: string | null;
  /** ISO datetime — when the paid membership expires. Null = no expiry (FREE or lifetime). */
  membershipExpiresAt?: string | null;
  /**
   * Membership code the user has scheduled to switch to at `scheduledChangeDate`.
   * Used by the downgrade flow — keeps the user on the current paid tier until
   * the end of the billing period, then a daily cron job applies the change.
   * `'FREE'` here means the membership will be fully cancelled.
   */
  scheduledMembershipChange?: string | null;
  /** ISO datetime — when the scheduled downgrade takes effect. */
  scheduledChangeDate?: string | null;
  avatarUrl: string | null;
  locale: 'en' | 'fr' | 'ar';
  createdAt: string;
  updatedAt: string;

  // ─── Network Pass / Partner Membership extensions ───────────────────────
  // All fields below are optional for backward compatibility: existing users
  // simply lack the keys and behave as untiered EXPLORER with zero credits.

  /** Resolved tier for the Network Pass system. Defaults to 'EXPLORER'. */
  membershipTier?: MembershipTier;
  /** ISO datetime — when the active membership started. */
  membershipStartDate?: string | null;
  /** ISO datetime — when the paid membership renews / re-charges. */
  membershipRenewalDate?: string | null;

  /** Network pass credits remaining this billing cycle. */
  networkCredits?: number;
  /** Monthly allowance — 3 for Builder, 10 for Founder, 0 for Explorer. */
  networkCreditsMax?: number;
  /** ISO datetime — next 1st-of-month UTC when credits reset to networkCreditsMax. */
  networkCreditsResetDate?: string | null;

  /** PartnerMembershipRecord.id of the partner who referred this user. */
  affiliatedPartnerId?: string | null;
  /** % discount the user received via the partner referral (e.g. 50). */
  membershipDiscountReceived?: number | null;

  /** Denormalised counter — number of pass redemptions in the current month. */
  networkPassesUsedThisMonth?: number;
  /** Unique SpaceRecord.ids visited via Network Pass. Used for fraud signals. */
  networkSpacesVisited?: string[];
  /** ISO datetime of the most recent successful network visit. */
  lastNetworkVisit?: string | null;
  /**
   * ISO datetime — when the last low-credit warning email was sent.
   * Used to prevent re-sending the warning multiple times in the same month.
   */
  lastLowCreditWarningDate?: string | null;
}

export interface SessionRecord {
  /** SHA-256 of the random session ID. The plaintext ID is only ever in the cookie. */
  idHash: string;
  userId: string;
  expiresAt: string;
  createdAt: string;
}

export interface OtpRecord {
  id: string;
  userId: string;
  /** HMAC-SHA256(code, AUTH_SECRET) — protects against DB-leak rainbow attacks */
  codeHash: string;
  expiresAt: string;
  attempts: number;
  consumed: boolean;
}

export interface EmailTokenRecord {
  /** SHA-256 of the random token */
  tokenHash: string;
  userId: string;
  expiresAt: string;
  consumed: boolean;
}

export interface PasswordResetRecord {
  tokenHash: string;
  userId: string;
  expiresAt: string;
  consumed: boolean;
}

/**
 * Temporary signup record held while the user verifies their phone number.
 * Promoted to a real UserRecord (and deleted) once the OTP is accepted.
 * The record expires after 10 minutes — stale entries are swept on each write.
 */
export interface PendingUserRecord {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  passwordHash: string;
  role: UserRole;
  city: string;
  locale: 'en' | 'fr' | 'ar';
  /** HMAC-SHA256(otp_code, AUTH_SECRET) — never stored in plaintext. */
  otpHash: string;
  otpAttempts: number;
  /** OTP expiry. The whole record is invalid after this time. */
  expiresAt: string;
  createdAt: string;
  /** Only set when role === 'INCUBATOR'. Used to create the IncubatorRecord. */
  incubatorName?: string;
}

/* ─────────────────────────── Wallet ─────────────────────────── */

/**
 * A user's wallet. Amounts are stored as **integer DZD** (no decimals)
 * to avoid floating-point drift. Convert to/from float only at display time.
 */
export interface WalletRecord {
  id: string;
  userId: string;
  /** Integer DZD. Always >= 0. */
  balance: number;
  currency: 'DZD';
  status: 'ACTIVE' | 'FROZEN';
  createdAt: string;
  updatedAt: string;
}

export type TransactionType =
  | 'TOP_UP'
  | 'PAYMENT'
  | 'REFUND'
  | 'ADJUSTMENT'
  | 'PAYOUT'
  | 'COMMISSION';

export type TransactionStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'REVERSED';

/**
 * Immutable ledger entry. Once written, fields other than `status` and
 * `completedAt` should never change — corrections are made by inserting
 * an opposing REFUND/ADJUSTMENT row.
 */
export interface TransactionRecord {
  id: string;
  walletId: string;
  /** Denormalized for fast user-scoped queries. */
  userId: string;
  type: TransactionType;
  /** Signed integer DZD: positive = credit (in), negative = debit (out). */
  amount: number;
  /** Wallet balance after this entry was applied. */
  balanceAfter: number;
  status: TransactionStatus;
  description: string;
  /**
   * Idempotency key. Unique per wallet for COMPLETED rows. Can be a
   * provider txn id, a top-up id, a booking id, etc.
   */
  reference: string;
  /** Provider code: 'mock' | 'slickpay' | 'internal' | … */
  provider: string;
  providerTxnId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  completedAt: string | null;
}

export type TopUpStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'EXPIRED';

/**
 * Top-up intent. Created when the user requests a top-up; transitions to
 * COMPLETED via provider webhook (or synchronously for the mock provider).
 */
export interface TopUpIntentRecord {
  id: string;
  userId: string;
  walletId: string;
  /** Integer DZD. */
  amount: number;
  provider: string;
  /** Provider-side reference (their txn / invoice id). */
  providerRef: string | null;
  status: TopUpStatus;
  /** Hosted-checkout URL, if the provider needs a redirect. */
  redirectUrl: string | null;
  /** Set when status transitions to COMPLETED. */
  transactionId: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ─────────────────────────── Bookings ─────────────────────────── */

export type BookingStatus = 'PENDING' | 'PENDING_PAYMENT' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED' | 'REFUNDED';
export type BookingItemKind = 'SPACE' | 'PROGRAM' | 'EVENT';
export type BookingUnit = 'HOUR' | 'DAY' | 'MONTH';
/**
 * How a booking was paid for. Legacy values 'wallet' / 'manual' are kept
 * for backward compatibility; uppercase values are introduced alongside the
 * Network Pass and Partner Program features.
 */
export type BookingPaymentMethod =
  | 'wallet'
  | 'manual'
  | 'NETWORK_PASS'
  | 'PROGRAM'
  | 'PARTNER_DISCOUNT';

/**
 * Booking ledger entry. The wallet transaction that paid for it is
 * referenced by `transactionId` so the two records stay linkable.
 */
export interface BookingRecord {
  id: string;
  /**
   * Platform user who booked. Null for offline / manually-entered bookings
   * where the client does not have a Metwork account.
   */
  userId: string | null;
  /** 'online' = booked via the platform wallet; 'offline' = manually added by incubator. */
  source?: 'online' | 'offline';
  /**
   * How the booking was paid for.
   * - 'wallet' — Metwork wallet balance.
   * - 'manual' — cash / cheque / external (offline incubator entry).
   * - 'NETWORK_PASS' — redeemed via a monthly network credit.
   * - 'PROGRAM' — covered by program enrolment fee (no separate charge).
   * - 'PARTNER_DISCOUNT' — partner-referred booking with applied discount.
   */
  paymentMethod?: BookingPaymentMethod;
  /** When paymentMethod === 'NETWORK_PASS', the NetworkVisitRecord.id created. */
  networkVisitId?: string | null;
  /** For offline bookings: client's full name (not necessarily a platform user). */
  clientName?: string | null;
  clientPhone?: string | null;
  clientEmail?: string | null;
  /** National ID / passport number — shown on the receipt. */
  clientIdNumber?: string | null;
  itemKind: BookingItemKind;
  itemId: string;
  /** Cached display fields — denormalized so the bookings list doesn't need a join. */
  itemName: string;
  vendorName: string;
  city: string;
  unit: BookingUnit;
  quantity: number;
  startsAt: string;
  endsAt: string;
  /** Integer DZD. */
  totalAmount: number;
  status: BookingStatus;
  /** Idempotency key supplied by the client. Unique per (userId). */
  clientReference: string;
  /** Wallet transaction that paid for this booking. Null for cash bookings. */
  transactionId: string | null;
  /** Promo code applied to this booking. Null if no promo was used. */
  promoCodeId?: string | null;
  /**
   * Optional free-text notes added by the incubator for manual bookings.
   */
  notes?: string | null;
  /** Admin-supplied reason when a booking is declined/cancelled. */
  declineReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ─────────────────────────── Contact ─────────────────────────── */

export interface ContactSubmissionRecord {
  id: string;
  name: string;
  email: string;
  message: string;
  /** True once an admin has marked the submission as handled. */
  handled?: boolean;
  createdAt: string;
}

/* ─────────────────────────── Incubators ─────────────────────────── */

export type IncubatorStatus = 'PENDING' | 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
export type IncubatorSubscription = 'COMMISSION' | 'FLAT';
export type IncubatorBillingCycle = 'SEMESTERLY' | 'YEARLY';
export type IncubatorSubscriptionStatus = 'ACTIVE' | 'NONE' | 'EXPIRED';

export interface IncubatorRecord {
  id: string;
  name: string;
  description?: string | null;
  email?: string;
  phone?: string;
  city: string;
  /** References UserRecord.id — the INCUBATOR-role user that manages this profile */
  managerId?: string | null;
  status: IncubatorStatus;
  website?: string | null;
  /** Billing model — legacy alias. Prefer subscriptionCode. */
  subscriptionTier?: 'COMMISSION' | 'FLAT';
  /** Billing model: 'COMMISSION' = platform takes a cut; 'FLAT' = periodic fee. */
  subscriptionCode?: IncubatorSubscription;
  billingCycle?: IncubatorBillingCycle | null;
  subscriptionStatus?: IncubatorSubscriptionStatus;
  subscriptionPeriodStart?: string | null;
  subscriptionPeriodEnd?: string | null;
  subscriptionLastPaidAmount?: number | null;
  logoUrl?: string | null;
  stampUrl?: string | null;
  /** Physical / postal address — printed on receipts. */
  address?: string | null;
  /** Commercial register number (RC in Algeria). */
  commercialRegNumber?: string | null;
  registrationNumber?: string | null;
  /** Tax identification number (NIF in Algeria). */
  nif?: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ─────────────────────────── User Memberships ─────────────────────────── */

export interface UserMembershipRecord {
  id: string;
  userId: string;
  /** Matches a membershipTier code: 'FREE' | 'ENTREPRENEUR' | 'STARTUP' */
  plan: string;
  startsAt: string;
  /** Null = perpetual (used for FREE tier) */
  expiresAt: string | null;
  status: 'ACTIVE' | 'EXPIRED' | 'CANCELLED';
  createdAt: string;
  updatedAt: string;
}

/* ─────────────────────────── Commission Rules ─────────────────────────── */

export interface CommissionRuleRecord {
  id: string;
  name: string;
  /** The transaction / booking type this rule applies to */
  transactionType: string;
  /** Decimal 0–1, e.g. 0.07 = 7 % */
  rate: number;
  description: string;
  isActive: boolean;
  updatedAt: string;
}

/* ─────────────────────────── Audit Log ─────────────────────────── */

export type AuditAction =
  | 'USER_BANNED'
  | 'USER_SUSPENDED'
  | 'USER_REINSTATED'
  | 'USER_ROLE_CHANGED'
  | 'USER_DELETED'
  | 'MEMBERSHIP_CHANGED'
  | 'INCUBATOR_CREATED'
  | 'INCUBATOR_UPDATED'
  | 'INCUBATOR_DELETED'
  | 'PROMO_CODE_CREATED'
  | 'PROMO_CODE_UPDATED'
  | 'PLATFORM_SETTINGS_UPDATED'
  | 'COMMISSION_RULE_UPDATED'
  | 'CREDIT_CONFIG_UPDATED'
  | 'PARTNER_ENROLLED'
  | 'PARTNER_UNENROLLED'
  | 'PARTNER_SETTINGS_UPDATED'
  | 'PARTNER_PROMO_CODE_GENERATED'
  | 'PARTNER_PROMO_CODE_BULK_GENERATED'
  | 'WITHDRAWAL_APPROVED'
  | 'WITHDRAWAL_REJECTED'
  | 'ACCOUNT_DELETED';

export interface AuditLogRecord {
  id: string;
  adminId: string;
  adminEmail: string;
  action: AuditAction;
  /** 'user' | 'incubator' | 'membership' | 'promo_code' | … */
  targetType: string;
  targetId: string;
  details: Record<string, unknown>;
  createdAt: string;
}

/* ─────────────────────────── Promo Codes ─────────────────────────── */

export interface PromoCodeRecord {
  id: string;
  /** Unique uppercase code that users enter at checkout. */
  code: string;
  /** Discount percentage 1–100. */
  discountPercent: number;
  /** What the promo applies to. 'ALL' = any purchase. */
  appliesTo: 'ALL' | 'MEMBERSHIP' | 'SPACE' | 'CONSULTATION';
  /** ISO datetime. Null = never expires. */
  expiresAt: string | null;
  /** Max total redemptions. Null = unlimited. */
  usageLimit: number | null;
  /** How many times this code has been successfully used. */
  usedCount: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/* ─────────────────────────── Platform Settings ─────────────────────────── */

export interface PlatformSettingsRecord {
  appName: string;
  maintenanceMode: boolean;
  signupsEnabled: boolean;
  paymentsEnabled: boolean;
  updatedAt: string;
}

/* ─────────────────────────── Startup Marketplace ───────────────── */

export type StartupListingStatus = 'DRAFT' | 'ACTIVE' | 'CLOSED';

export interface StartupListingRecord {
  id: string;
  /** Display name of the startup. */
  name: string;
  description: string;
  industry: string;
  /** Funding target in integer DZD. */
  fundingGoal: number;
  /** Equity offered as a percentage (e.g. 15.5 = 15.5 %). */
  equityOffered: number;
  /** Pre-money valuation in integer DZD. Optional. */
  valuation: number | null;
  /** References UserRecord.id — must be a ENTREPRENEUR role user. */
  founderId: string;
  status: StartupListingStatus;
  createdAt: string;
  updatedAt: string;
}

/* ─────────────────────────── Payment Methods ─────────────────────────── */

/** Accepted client payment methods on a listing or booking. */
export type PaymentMethod = 'ONLINE' | 'CASH';

/* ─────────────────────────── Platform Catalog (Spaces / Programs / Events) ── */

import type { SpaceCategory, ProgramType } from '@/types/domain';

export interface SpaceRecord {
  id: string;
  incubatorId: string;
  incubatorName: string;
  name: string;
  description: string;
  category: SpaceCategory;
  city: string;
  imageUrl: string | null;
  pricePerHour: number | null;
  pricePerDay: number | null;
  pricePerMonth: number | null;
  capacity: number;
  amenities: string[];
  /** Accepted client payment methods. Commission incubators: always ['ONLINE']. */
  acceptedPaymentMethods: PaymentMethod[];
  /**
   * Days of the week this space is open.
   * 0 = Sunday, 1 = Monday … 6 = Saturday.
   * Defaults to [1,2,3,4,5] (Monday–Friday).
   */
  workingDays: number[];
  /** Opening time in "HH:MM" 24-hour format. Defaults to "09:00". */
  openingTime: string;
  /** Closing time in "HH:MM" 24-hour format. Defaults to "18:00". */
  closingTime: string;
  /** ISO date strings (YYYY-MM-DD) when this space is unavailable. */
  unavailableDates?: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;

  // ─── Partner Program extensions ────────────────────────────────────────
  /**
   * PartnerMembershipRecord.id when this space is enrolled in the Partner
   * Program. Null/undefined = not enrolled. Settings (discount %, network
   * payout rate, acceptance flags) live on PartnerMembershipRecord.
   */
  partnerMembershipId?: string | null;
  /**
   * Convenience flag — true when an active partner enrolment exists for
   * this space AND `acceptNetworkPasses` is on for that enrolment. Kept
   * denormalised so the public spaces filter can avoid a join.
   */
  isPartnerInNetwork?: boolean;
}

export interface ProgramRecord {
  id: string;
  incubatorId: string;
  incubatorName: string;
  title: string;
  description: string;
  type: ProgramType;
  city: string;
  imageUrl: string | null;
  price: number;
  seatsTotal: number;
  deadline: string;
  startDate: string;
  endDate: string;
  acceptedPaymentMethods: PaymentMethod[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EventRecord {
  id: string;
  incubatorId: string;
  incubatorName: string;
  title: string;
  description: string;
  city: string;
  imageUrl: string | null;
  price: number;
  isOnline: boolean;
  capacity: number;
  eventDate: string;
  acceptedPaymentMethods: PaymentMethod[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/* ─────────────── Network Passes & Partner Program ─────────────── */

/**
 * Tracks a single coworking visit redeemed against a network pass credit.
 * Created when the entrepreneur is checked in at a partner space.
 * Drives the monthly payout batch run for partner spaces.
 */
export type NetworkVisitCheckInMethod = 'QR' | 'MANUAL' | 'AUTO';
export type NetworkVisitPayoutStatus = 'PENDING' | 'PAID' | 'FAILED';

export interface NetworkVisitRecord {
  id: string;
  /** UserRecord.id of the entrepreneur using the pass. Indexed. */
  userId: string;
  /** SpaceRecord.id of the host partner space. Indexed. */
  spaceId: string;
  /** BookingRecord.id of the booking this visit settles. Indexed. */
  bookingId: string;

  // Check-in metadata — nullable until the visitor actually arrives.
  checkedInAt: string | null;
  /** UserRecord.id of the staff member who confirmed check-in. */
  checkedInBy: string | null;
  checkedInMethod: NetworkVisitCheckInMethod | null;

  // Payout tracking — partner space earns a flat fee per visit.
  payoutStatus: NetworkVisitPayoutStatus;
  /** Integer DZD. Defaults to 300; admin-configurable per partner. */
  payoutAmount: number;
  /** Identifier of the bulk payout batch this visit was included in. */
  payoutBatchId: string | null;
  paidOutDate: string | null;

  createdAt: string;
  updatedAt: string;
}

/**
 * Partner Program enrolment for a single Space. The Space's owning
 * Incubator opts in/out via this record. Settings are scoped to the
 * enrolment so each Space can be tuned independently.
 *
 * Uniqueness rule (enforced in the API layer):
 *   - At most ONE PartnerMembershipRecord per spaceId.
 */
export interface PartnerMembershipRecord {
  id: string;
  /** SpaceRecord.id this enrolment belongs to. Unique. Indexed. */
  spaceId: string;
  /** False = enrolment paused; bookings via partner channels are rejected. */
  isActive: boolean;

  // Discounted membership offering.
  /** Whether this partner can issue 50%-off Builder/Founder promo codes. */
  offerDiscountedMemberships: boolean;
  /** 1–99. Default 50. Validated in API layer. */
  discountPercentage: number;
  /** Hard cap on issued+redeemed codes. Null = unlimited. */
  maxDiscountedMembers: number | null;
  /** Counter of codes redeemed under this partner. Maintained on use. */
  discountedMembersCount: number;

  // Network pass acceptance.
  /** Whether the partner space accepts bookings paid via NETWORK_PASS. */
  acceptNetworkPasses: boolean;
  /** Integer DZD paid to partner per accepted network visit. Default 300. */
  networkPayoutRate: number;
  /** Soft daily ceiling for network visitors. Null = no limit. */
  maxNetworkUsersPerDay: number | null;

  createdAt: string;
  updatedAt: string;
  /** UserRecord.id of the admin who last edited this enrolment. */
  lastUpdatedBy: string | null;
}

export type PartnerPromoCodeTier = 'BUILDER' | 'FOUNDER';

/**
 * One-time promo code that grants a discounted membership purchase.
 * The plaintext `code` is generated client-side (admin tool); the stored
 * value should be hashed in the API layer before persistence.
 */
export interface PartnerPromoCodeRecord {
  id: string;
  /**
   * The user-facing redemption code, e.g. "PARTNER-ORAN-2026-AB12X".
   * NOTE: API layer hashes this before storage (see DATABASE_CHANGES.md
   * "Security" section). On read, the hash is compared, never displayed.
   */
  code: string;
  /** PartnerMembershipRecord.id that issued this code. Indexed. */
  partnerId: string;
  /** PartnerPromoCodeBatchRecord.id when the code was bulk-generated. */
  batchId: string | null;

  // Code configuration.
  /** 1–99. Inherited from partner at creation but immutable afterwards. */
  discountPercentage: number;
  membershipTier: PartnerPromoCodeTier;
  validFrom: string;
  /** Typically validFrom + 30 days. Indexed for expiry sweeps. */
  validUntil: string;

  // Redemption state.
  isUsed: boolean;
  /** UserRecord.id of the redeemer. Null until used. */
  usedBy: string | null;
  usedAt: string | null;
  /** UserMembershipRecord.id created by the redemption. Null until used. */
  usedForMembership: string | null;

  createdAt: string;
  /** Email address the code was generated for (audit trail). */
  createdFor: string;
}

/**
 * Bulk-generation record — one PartnerPromoCodeBatchRecord references the
 * many PartnerPromoCodeRecord rows it created. Supports counts of 1–10,000.
 */
export interface PartnerPromoCodeBatchRecord {
  id: string;
  /** PartnerMembershipRecord.id this batch belongs to. Indexed. */
  partnerId: string;
  /** Number of codes generated in this batch. Validated 1..10000 in API. */
  count: number;
  membershipTier: PartnerPromoCodeTier;
  discountPercentage: number;
  validUntil: string;
  createdAt: string;
  /** UserRecord.id of the admin who triggered the bulk generation. */
  createdBy: string;
}

/**
 * Affiliation between a user and a partner. Set once at promo-code
 * redemption time and immutable thereafter (`createdAt` is the referral
 * moment). Enforces the "user can't be affiliated twice" rule in the API
 * layer via composite uniqueness on (userId, partnerId).
 */
export interface UserPartnerAffiliationRecord {
  id: string;
  /** UserRecord.id. Indexed. */
  userId: string;
  /** PartnerMembershipRecord.id. Indexed. */
  partnerId: string;
  referredAt: string;
  /** PartnerPromoCodeRecord.code (plaintext at redemption time). */
  promoCodeUsed: string;
}

/* ─────────────────── Network Pass Check-in Codes ─────────────────── */

/**
 * Single-use check-in code issued at booking confirmation time for
 * Network Pass bookings. The plaintext code (format "MNP-{year}-{N5}")
 * is NEVER stored — only the SHA-256 hash is persisted, so a DB leak
 * cannot be used to fabricate valid check-ins.
 *
 * Lookup at reception is by `bookingId` (from the QR or manually typed
 * code prefix); the staff-submitted code is then SHA-256-hashed and
 * compared to `codeHash`. Constant-time compare in the API layer.
 *
 * One row per booking. Lifecycle:
 *   issued → (scanned) → consumed → (or) expired
 *
 * NOTE: storing this in a separate collection — rather than as new
 * fields on BookingRecord — keeps the booking model unchanged (per the
 * "no new Booking fields" constraint).
 */
export interface NetworkCheckInCodeRecord {
  id: string;
  /** BookingRecord.id — one code per booking, enforced in the API layer. Indexed. */
  bookingId: string;
  /** SpaceRecord.id where the booking will be redeemed. Indexed. */
  spaceId: string;
  /** UserRecord.id of the entrepreneur. Indexed. */
  userId: string;

  /** SHA-256 of the plaintext code. Plaintext is shown to user once via email. */
  codeHash: string;
  /** ISO datetime — typically 23:59:59 UTC on the booking day. */
  expiresAt: string;
  /** Sequential code number used to compose the display string. */
  sequenceNumber: number;

  /** Whether the code has already been redeemed. */
  consumed: boolean;
  /** ISO datetime — when the code was successfully redeemed. */
  consumedAt: string | null;
  /** NetworkVisitRecord.id created on redemption. */
  visitId: string | null;

  createdAt: string;
}

/**
 * Audit log entry for EVERY check-in attempt — successful or failed.
 * Separate from the admin AuditLogRecord because the volume is different
 * (per-attempt, not per-admin-action) and the schema diverges.
 *
 * Retention: kept indefinitely for fraud investigation.
 */
export type NetworkCheckInResult =
  | 'SUCCESS'
  | 'BOOKING_NOT_FOUND'
  | 'WRONG_SPACE'
  | 'WRONG_DATE'
  | 'WRONG_PAYMENT_METHOD'
  | 'BOOKING_NOT_CONFIRMED'
  | 'INVALID_CODE'
  | 'ALREADY_CHECKED_IN'
  | 'EXPIRED'
  | 'FRAUD_SUSPECTED'
  | 'ERROR';

export interface NetworkCheckInAuditRecord {
  id: string;
  /** ISO datetime when the attempt was made. Indexed. */
  attemptedAt: string;
  /** SpaceRecord.id where the scan happened (the SCANNER, not the booking). Indexed. */
  spaceId: string;
  /** BookingRecord.id when known. Null when QR/code couldn't be parsed. */
  bookingId: string | null;
  /** UserRecord.id of the entrepreneur. Null when unknown. */
  userId: string | null;
  /** 'QR' or 'MANUAL'. */
  method: 'QR' | 'MANUAL';
  result: NetworkCheckInResult;
  /** UserRecord.id of the staff member who performed the scan. Null = anonymous. */
  staffUserId: string | null;
  /** Free-form details (e.g. "duplicate within 5 min", IP, etc.). */
  details: Record<string, unknown>;
}

/* ─────────────────────────── Mentors ─────────────────────────── */

export type MentorBookingStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface MentorBookingRecord {
  id: string;
  mentorId: string;
  /** References UserRecord.id. Null for unauthenticated requests. */
  userId: string | null;
  userName: string;
  userEmail: string;
  userPhone: string;
  message: string;
  status: MentorBookingStatus;
  adminNote: string | null;
  /** Requested consultation date "YYYY-MM-DD". */
  consultationDate?: string | null;
  /** Requested start time "HH:MM". */
  consultationTime?: string | null;
  /** Requested duration in minutes (30–180). */
  durationMinutes?: number | null;
  /** ISO datetime confirmed by admin for the session. */
  scheduledAt?: string | null;
  /** Video/online meeting link set by admin on approval. */
  meetLink?: string | null;
  /** True when the session is held in-person (admin sets on approval). */
  isOffline?: boolean;
  /** Applied promo code. */
  appliedPromoCode?: string | null;
  /** Promo code discount percentage (0–100). */
  promoDiscountPercent?: number | null;
  /**
   * Whether this booking is being paid with a free monthly credit or paid.
   * When FREE_QUOTA, `amountCharged === 0` and a matching row exists in
   * `mentorConsultations` so the credit is properly consumed.
   */
  chargeType?: 'FREE_QUOTA' | 'PAID';
  /** Membership-tier discount fraction applied (e.g. 0.20 for STARTUP). */
  discountFraction?: number;
  /** 'YYYY-MM' month the free credit was charged against (when chargeType === 'FREE_QUOTA'). */
  freeQuotaMonth?: string | null;
  /** Final integer DZD amount the admin should collect (0 for FREE_QUOTA). */
  amountCharged?: number;
  createdAt: string;
  updatedAt: string;
}

export interface MentorRecord {
  id: string;
  fullName: string;
  position: string;
  imageUrl: string;
  bio: string | null;
  linkedinUrl: string | null;
  /** Contact email for consultation notifications. */
  email?: string | null;
  /** Optional per-session fee in DZD. 0 or absent = free. */
  consultationFee?: number;
  createdAt: string;
}

/* ─────────────────── CRM — Clients ─────────────────── */

export interface ClientRecord {
  id: string;
  incubatorId: string;
  fullName: string;
  email: string;
  phone: string;
  idCardNumber: string | null;
  companyName: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ─────────────────── Services catalog ─────────────────── */

export interface ServiceRecord {
  id: string;
  incubatorId: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export const DEFAULT_SERVICES: Omit<ServiceRecord, 'id' | 'incubatorId' | 'createdAt' | 'updatedAt'>[] = [
  { name: 'Coworking',            description: null, isActive: true },
  { name: 'Private Office',       description: null, isActive: true },
  { name: 'Training Room',        description: null, isActive: true },
  { name: 'Domiciliation',        description: null, isActive: true },
  { name: 'Training',             description: null, isActive: true },
  { name: 'Incubation Program',   description: null, isActive: true },
  { name: 'Acceleration Program', description: null, isActive: true },
];

/* ─────────────────── Expenses ─────────────────── */

export interface ExpenseRecord {
  id: string;
  incubatorId: string;
  /** ISO date string (YYYY-MM-DD) */
  date: string;
  title: string;
  description: string | null;
  amount: number;
  category: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ─────────────────── Income (manual / CSV-imported operations) ─────────────────── */

export type IncomePaymentMethod = 'CASH' | 'ONLINE' | 'OTHER';

export interface IncomeRecord {
  id: string;
  incubatorId: string;
  /** FK to ClientRecord. Null for anonymous / legacy imports without a match. */
  clientId: string | null;
  /** Denormalised for fast display — always kept in sync with the ClientRecord. */
  clientName: string;
  serviceName: string;
  /** FK to ServiceRecord.id. May be null for free-text imports. */
  serviceId: string | null;
  /** ISO date string (YYYY-MM-DD) */
  date: string;
  amount: number;
  paymentMethod: IncomePaymentMethod;
  notes: string | null;
  /** UUID shared by all rows in the same CSV upload batch. */
  importBatchId: string | null;
  /** FK to BookingRecord.id — set when income is linked to a platform booking. */
  bookingId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Platform-wide configurable fees. Editable by admin. */
export interface PlatformConfig {
  /** Monthly price (DZD) for FLAT subscription before billing-cycle discount. Default 5000. */
  flatMonthlyPrice: number;
  /** Number of months in a SEMESTERLY billing cycle. Default 6. */
  semesterlyMonths: number;
  /** Yearly discount percentage applied on top of monthly rate. Default 30 (= 30%). */
  yearlyDiscountPercent: number;
  /** Commission rate (0–1) taken on bookings for COMMISSION-plan incubators. Default 0.20. */
  commissionRate: number;

  // ─── Network Pass credit allowances (admin-configurable) ─────────────
  /** Monthly pass credits for Builder-tier users. Default 3. */
  builderMonthlyCredits?: number;
  /** Monthly pass credits for Founder-tier users. Default 10. */
  founderMonthlyCredits?: number;
  /** ISO datetime — last time a credit-config change was saved. */
  creditConfigUpdatedAt?: string;
  /** UserRecord.id of the admin who last changed the credit config. */
  creditConfigUpdatedBy?: string;
}

export const defaultPlatformConfig: PlatformConfig = {
  flatMonthlyPrice: 5_000,
  semesterlyMonths: 6,
  yearlyDiscountPercent: 30,
  commissionRate: 0.20,
  builderMonthlyCredits: 3,
  founderMonthlyCredits: 10,
};

/* ─────────────────────────── Notifications ─────────────────────────── */

export type NotificationType =
  | 'BOOKING_CONFIRMED'
  | 'BOOKING_CANCELLED'
  | 'BOOKING_PENDING_PAYMENT'
  | 'PROGRAM_APPLIED'
  | 'EVENT_REGISTERED'
  | 'WALLET_CREDITED'
  | 'WALLET_DEBITED'
  | 'MEMBERSHIP_UPGRADED'
  | 'CONSULTATION_APPROVED'
  | 'CONSULTATION_REJECTED'
  | 'NETWORK_CREDIT_LOW'
  | 'NETWORK_CREDITS_RESET'
  | 'PARTNER_PROMO_RECEIVED'
  | 'GENERAL';

export interface NotificationRecord {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  href: string | null;
  read: boolean;
  createdAt: string;
}

/* ─────────────────────────── Investor contacts ─────────────────────────── */

export type InvestorContactStatus = 'PENDING' | 'CONNECTED' | 'DECLINED';

export interface InvestorContactRecord {
  id: string;
  investorId: string;
  investorName: string;
  investorEmail: string;
  startupId: string;
  startupName: string;
  founderName: string;
  message: string;
  status: InvestorContactStatus;
  adminNote: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ─────────────────────────── Saved startups ─────────────────────────── */

export interface SavedStartupRecord {
  id: string;
  userId: string;
  startupId: string;
  createdAt: string;
}

/* ─────────────────────────── Investments ─────────────────────────── */

export type InvestmentStatus =
  | 'PROSPECTING'
  | 'TERM_SHEET'
  | 'DUE_DILIGENCE'
  | 'CLOSED'
  | 'PASSED'
  | 'PENDING'
  | 'ACTIVE'
  | 'CANCELLED';

export interface InvestmentRecord {
  id: string;
  investorId: string;
  startupId: string | null;
  startupName: string;
  /** Investment amount in integer DZD. */
  amount: number;
  /** Equity percentage offered, e.g. 10.5 = 10.5 %. */
  equity: number;
  status: InvestmentStatus;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

/* ─────────────────────────── Withdrawal requests ─────────────────────────── */

export type WithdrawalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface WithdrawalRequestRecord {
  id: string;
  userId: string;
  /** Integer DZD. */
  amount: number;
  /** Free-text payment details (CCP / BaridiMob / bank account). */
  accountDetails: string;
  status: WithdrawalStatus;
  /** Transaction ID for the escrow hold deducted from the wallet. */
  holdTransactionId: string;
  /** Transaction ID for the refund issued on rejection. */
  refundTransactionId?: string | null;
  /** Admin note (reason for rejection, etc.). */
  adminNote?: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ─────────────────────────── Mentor consultations ─────────────────────────── */

export type MentorConsultationStatus =
  | 'CONFIRMED'
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'COMPLETED';

export type ConsultationChargeType = 'FREE_QUOTA' | 'PAID';

export interface MentorConsultationRecord {
  id: string;
  userId: string;
  mentorId: string;
  mentorName: string;
  status: MentorConsultationStatus;
  message: string;
  /**
   * Links this consultation row to the originating `MentorBookingRecord` so
   * admin approve/reject can synchronously update the quota state (e.g. flip
   * PENDING → CONFIRMED on approval, or → CANCELLED on rejection to release
   * the monthly free credit).
   */
  bookingId?: string | null;
  /** ISO datetime of the scheduled session. Null until admin confirms a time. */
  scheduledAt?: string | null;
  durationMinutes?: number | null;
  chargeType: ConsultationChargeType;
  /** 'YYYY-MM' — the month this consultation counted against the free quota. */
  quotaMonth: string;
  /** Fee actually charged (0 for FREE_QUOTA sessions). */
  amountCharged: number;
  /** Wallet transaction ID for paid sessions. */
  transactionId: string | null;
  adminNote?: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ─────────────────────────── Type aliases for catalog records ─────────────────────────── */

/** @deprecated Use SpaceRecord directly. Kept for backward compatibility. */
export type IncubatorSpaceRecord = SpaceRecord;
/** @deprecated Use ProgramRecord directly. Kept for backward compatibility. */
export type IncubatorProgramRecord = ProgramRecord;
/** @deprecated Use EventRecord directly. Kept for backward compatibility. */
export type IncubatorEventRecord = EventRecord;

interface DbShape {
  pendingUsers: PendingUserRecord[];
  users: UserRecord[];
  sessions: SessionRecord[];
  otps: OtpRecord[];
  emailTokens: EmailTokenRecord[];
  passwordResets: PasswordResetRecord[];
  wallets: WalletRecord[];
  transactions: TransactionRecord[];
  topUpIntents: TopUpIntentRecord[];
  bookings: BookingRecord[];
  contactSubmissions: ContactSubmissionRecord[];
  startupListings: StartupListingRecord[];
  mentors: MentorRecord[];
  mentorBookings: MentorBookingRecord[];
  incubators: IncubatorRecord[];
  promoCodes: PromoCodeRecord[];
  /** DB-persisted space listings created by incubators. */
  spaces: SpaceRecord[];
  /** DB-persisted program listings created by incubators. */
  programs: ProgramRecord[];
  /** DB-persisted event listings created by incubators. */
  events: EventRecord[];
  /** CRM — client records per incubator. */
  clients: ClientRecord[];
  /** Per-incubator service catalog (used in manual income / CSV imports). */
  services: ServiceRecord[];
  /** Manual and imported expense operations. */
  expenses: ExpenseRecord[];
  /** Manual and imported income operations (separate from platform bookings). */
  income: IncomeRecord[];
  /** CMS-managed landing page content. Null = use hard-coded defaults. */
  landingContent: LandingContent | null;
  /** Admin-configurable platform-wide settings. */
  platformSettings: PlatformSettingsRecord | null;
  /** Admin-defined commission rules. */
  commissionRules: CommissionRuleRecord[];
  /** User membership records (one per active plan per user). */
  userMemberships: UserMembershipRecord[];
  /** Audit log entries for admin actions. */
  auditLogs: AuditLogRecord[];
  /** In-app notifications per user. */
  notifications: NotificationRecord[];
  /** Investor → startup contact requests. */
  investorContacts: InvestorContactRecord[];
  /** Startups bookmarked by investors. */
  savedStartups: SavedStartupRecord[];
  /** Investment deals recorded by investors. */
  investments: InvestmentRecord[];
  /** Wallet withdrawal requests submitted by users. */
  withdrawalRequests: WithdrawalRequestRecord[];
  /** Mentor consultation bookings (separate from mentor inquiry requests). */
  mentorConsultations: MentorConsultationRecord[];

  // ─── Network Pass & Partner Program ──────────────────────────────────
  /** Per-visit ledger backing the monthly partner payout batch run. */
  networkVisits: NetworkVisitRecord[];
  /** Partner Program enrolments — one per enrolled SpaceRecord. */
  partnerMemberships: PartnerMembershipRecord[];
  /** Single-use discount codes issued by partners. */
  partnerPromoCodes: PartnerPromoCodeRecord[];
  /** Bulk-generation manifests for partnerPromoCodes. */
  partnerPromoCodeBatches: PartnerPromoCodeBatchRecord[];
  /** User ↔ partner referral records. */
  userPartnerAffiliations: UserPartnerAffiliationRecord[];
  /** Per-booking single-use check-in codes (hash-only, never plaintext). */
  networkCheckInCodes: NetworkCheckInCodeRecord[];
  /** Per-attempt audit trail for every check-in scan or manual entry. */
  networkCheckInAuditLogs: NetworkCheckInAuditRecord[];

  /**
   * One-shot flags and platform-wide config.
   */
  meta: {
    mentorsSeeded?: boolean;
    promoCodesSeeded?: boolean;
    demoMentorsRemoved?: boolean;
    platformConfig?: PlatformConfig;
  };
}

const empty: DbShape = {
  pendingUsers: [],
  users: [],
  sessions: [],
  otps: [],
  emailTokens: [],
  passwordResets: [],
  wallets: [],
  transactions: [],
  topUpIntents: [],
  bookings: [],
  contactSubmissions: [],
  startupListings: [],
  mentors: [],
  mentorBookings: [],
  incubators: [],
  promoCodes: [],
  spaces: [],
  programs: [],
  events: [],
  clients: [],
  services: [],
  expenses: [],
  income: [],
  landingContent: null,
  platformSettings: null,
  commissionRules: [],
  userMemberships: [],
  auditLogs: [],
  notifications: [],
  investorContacts: [],
  savedStartups: [],
  investments: [],
  withdrawalRequests: [],
  mentorConsultations: [],
  networkVisits: [],
  partnerMemberships: [],
  partnerPromoCodes: [],
  partnerPromoCodeBatches: [],
  userPartnerAffiliations: [],
  networkCheckInCodes: [],
  networkCheckInAuditLogs: [],
  meta: {},
};

// ---------------------------------------------------------------------------
// Supabase client (service-role — never exposed to the browser)
// ---------------------------------------------------------------------------

let _supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (_supabase) return _supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in environment variables.',
    );
  }
  _supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    // Prevent Next.js Data Cache from caching Supabase fetch calls.
    // Without this, the App Router persists Supabase responses across requests,
    // causing data to appear/disappear depending on which cached response is served.
    global: {
      fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }),
    },
  });
  return _supabase;
}

// ---------------------------------------------------------------------------
// In-process cache + write queue (unchanged from file-store version)
// ---------------------------------------------------------------------------

let cache: DbShape | null = null;
let cacheAt = 0;
/**
 * How long (ms) the in-process cache is considered fresh.
 *
 * Vercel spins up multiple warm serverless instances simultaneously. A write
 * that lands on instance A updates A's cache and Supabase, but instance B
 * still holds its own stale snapshot. After CACHE_TTL_MS, every instance
 * discards its snapshot and re-reads from Supabase — bounding the window
 * during which different instances return different data for mentors / events
 * / spaces.
 */
const CACHE_TTL_MS = 10_000; // 10 s — safe for production read volumes
let writeQueue: Promise<unknown> = Promise.resolve();

/**
 * Load the DB from Supabase (or return the in-process cache if still fresh).
 *
 * PostgREST error PGRST116 = "no rows found" — treated as first run.
 */
async function load(): Promise<DbShape> {
  if (cache && Date.now() - cacheAt < CACHE_TTL_MS) return cache;
  // Cache is absent or stale — discard and re-fetch.
  cache = null;

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('app_state')
    .select('data')
    .eq('id', 1)
    .single();

  if (error) {
    // PGRST116 = no rows returned by .single() → first-run, seed empty state
    if (error.code === 'PGRST116') {
      cache = structuredClone(empty);
      await persist(cache);
    } else {
      throw new Error(`Supabase load failed: ${error.message} (code: ${error.code})`);
    }
  } else {
    const parsed = (data as { data: Partial<DbShape> }).data;
    cache = { ...empty, ...parsed };
  }

  // One-time migration: purge the 8 hardcoded demo mentor records and any
  // mentor bookings that reference them. Runs once, then the flag is set.
  if (!cache!.meta?.demoMentorsRemoved) {
    const DEMO_IDS = new Set([
      'mn_amina', 'mn_yacine', 'mn_nora', 'mn_karim',
      'mn_sara',  'mn_riad',  'mn_imane', 'mn_walid',
    ]);
    cache!.mentors       = (cache!.mentors       ?? []).filter((m) => !DEMO_IDS.has(m.id));
    cache!.mentorBookings = (cache!.mentorBookings ?? []).filter((b) => !DEMO_IDS.has(b.mentorId));
    cache!.meta = { ...(cache!.meta ?? {}), demoMentorsRemoved: true };
    await persist(cache!);
  }

  cacheAt = Date.now();
  return cache!;
}

/**
 * Persist the current in-memory state to Supabase via UPSERT.
 * Always updates row id = 1.
 */
async function persist(db: DbShape): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from('app_state')
    .upsert({ id: 1, data: db }, { onConflict: 'id' });
  if (error) {
    throw new Error(`Supabase persist failed: ${error.message} (code: ${error.code})`);
  }
}

// ---------------------------------------------------------------------------
// Public API (identical surface to the file-backed store)
// ---------------------------------------------------------------------------

/**
 * Read a deep clone of the current DB. Safe to mutate — won't affect the cache.
 */
export async function read(): Promise<DbShape> {
  const db = await load();
  return structuredClone(db);
}

/**
 * Mutate the DB inside a serialized critical section, then persist to Supabase.
 * The mutator may return a value, which becomes the resolved value.
 */
export async function update<T>(mutator: (db: DbShape) => T | Promise<T>): Promise<T> {
  const next = writeQueue.then(async () => {
    const db = await load();
    const result = await mutator(db);
    await persist(db);
    // Reset TTL so this instance's cache stays fresh after its own write.
    cacheAt = Date.now();
    return result;
  });
  // Keep the queue alive even if a mutator throws so subsequent writes still run.
  writeQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export const db = { read, update };
