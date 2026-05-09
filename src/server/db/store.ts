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
  avatarUrl: string | null;
  locale: 'en' | 'fr' | 'ar';
  createdAt: string;
  updatedAt: string;
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

export type BookingStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED' | 'REFUNDED';
export type BookingItemKind = 'SPACE' | 'PROGRAM' | 'EVENT';
export type BookingUnit = 'HOUR' | 'DAY' | 'MONTH';

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
  /** 'wallet' = paid via platform wallet; 'manual' = cash / cheque / external. */
  paymentMethod?: 'wallet' | 'manual';
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
  /** Wallet transaction that paid for this booking. */
  transactionId: string | null;
  /** Set when the incubator declines the booking. */
  declineReason?: string;
  createdAt: string;
  updatedAt: string;
}

/* ─────────────────────────── Withdrawal Requests ─────────────────────────── */

export type WithdrawalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

/**
 * A cash-out request submitted by an incubator or entrepreneur.
 * Funds are held (deducted from wallet) the moment the request is created.
 * Admin approves (external transfer) or rejects (wallet refunded).
 */
export interface WithdrawalRequestRecord {
  id: string;
  userId: string;
  /** Integer DZD requested. */
  amount: number;
  /**
   * Free-text bank details entered by the user:
   * e.g. "CCP: 1234567 clé 89 / BaridiMob RIP: 00799999000123456789"
   */
  accountDetails: string;
  status: WithdrawalStatus;
  /** Admin note on approval or rejection. */
  adminNote?: string;
  /** References TransactionRecord.id that debited the wallet on creation. */
  holdTransactionId: string | null;
  /** References TransactionRecord.id that refunded the wallet on rejection. */
  refundTransactionId?: string | null;
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

export interface IncubatorRecord {
  id: string;
  name: string;
  description: string;
  city: string;
  /** References UserRecord.id — the INCUBATOR-role user that manages this profile */
  managerId: string | null;
  status: 'ACTIVE' | 'SUSPENDED';
  website: string | null;
  logoUrl: string | null;
  /** Billing model chosen by the incubator */
  subscriptionTier: 'COMMISSION' | 'FLAT';
  /** Physical / postal address — printed on receipts. */
  address?: string | null;
  /** Commercial register number (RC in Algeria). */
  commercialRegNumber?: string | null;
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
  | 'COMMISSION_RULE_UPDATED';

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
  /** ISO datetime preferred by the user. Admin can override before approval. */
  scheduledAt?: string | null;
  /** Meeting link (Google Meet etc.) set by admin on approval. */
  meetLink?: string | null;
  /** True when admin marked the session as in-person / offline. */
  isOffline?: boolean;
  /** Applied promo code string, if any. */
  promoCode?: string | null;
  /** Discount percentage applied via promo code (0–100). */
  discountPercent?: number;
  /** Whether the approval notification email has been sent (prevents duplicates). */
  approvalEmailSentAt?: string | null;
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

/* ─────────────────────────── Investor Features ─────────────────────────── */

export interface SavedStartupRecord {
  id: string;
  userId: string;
  startupId: string;
  createdAt: string;
}

export type InvestorContactStatus = 'PENDING' | 'CONNECTED' | 'DECLINED';

export interface InvestorContactRecord {
  id: string;
  /** References UserRecord.id — the investor making the request */
  investorId: string;
  investorName: string;
  investorEmail: string;
  /** References StartupListingRecord.id */
  startupId: string;
  startupName: string;
  founderName: string;
  message: string;
  status: InvestorContactStatus;
  adminNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export type InvestmentStatus =
  | 'PROSPECTING'
  | 'TERM_SHEET'
  | 'DUE_DILIGENCE'
  | 'CLOSED'
  | 'PASSED';

export interface InvestmentRecord {
  id: string;
  /** References UserRecord.id */
  investorId: string;
  /** References StartupListingRecord.id — can be null for off-platform deals */
  startupId: string | null;
  startupName: string;
  /** Integer DZD committed */
  amount: number;
  /** Equity percentage e.g. 10.5 = 10.5 % */
  equity: number;
  status: InvestmentStatus;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

/* ─────────────────────────── Incubator Events ─────────────────────────────── */

export interface IncubatorEventRecord {
  id: string;
  /** References IncubatorRecord.id */
  incubatorId: string;
  /** Denormalized incubator name for fast list rendering */
  incubatorName: string;
  /** References UserRecord.id */
  managerId: string;
  title: string;
  description: string;
  city: string;
  imageUrl: string | null;
  /** Integer DZD. 0 = free. */
  price: number;
  isOnline: boolean;
  /** Total seat capacity */
  capacity: number;
  /** ISO datetime of the event */
  eventDate: string;
  status: 'DRAFT' | 'PUBLISHED' | 'CANCELLED';
  createdAt: string;
  updatedAt: string;
}

/* ─────────────────────────── Incubator Spaces & Programs ─────────────────── */

export type IncubatorSpaceCategory =
  | 'COWORKING'
  | 'PRIVATE_OFFICE'
  | 'TRAINING_ROOM'
  | 'DOMICILIATION';

export type IncubatorProgramType =
  | 'INCUBATION'
  | 'ACCELERATION'
  | 'TRAINING'
  | 'BOOTCAMP'
  | 'WORKSHOP';

export interface IncubatorSpaceRecord {
  id: string;
  /** References IncubatorRecord.id */
  incubatorId: string;
  /** Denormalized incubator name (for fast booking display) */
  incubatorName: string;
  /** References UserRecord.id — the INCUBATOR user managing this space */
  managerId: string;
  name: string;
  description: string;
  category: IncubatorSpaceCategory;
  city: string;
  imageUrl: string | null;
  /** Integer DZD. Null = not bookable by hour. */
  pricePerHour: number | null;
  pricePerDay: number | null;
  pricePerMonth: number | null;
  capacity: number;
  amenities: string[];
  status: 'ACTIVE' | 'INACTIVE';
  /** ISO date strings (YYYY-MM-DD) on which bookings are blocked. */
  unavailableDates?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface IncubatorProgramRecord {
  id: string;
  incubatorId: string;
  incubatorName: string;
  managerId: string;
  title: string;
  description: string;
  type: IncubatorProgramType;
  city: string;
  imageUrl: string | null;
  /** Integer DZD. 0 = free. */
  price: number;
  seatsTotal: number;
  /** ISO date string — application deadline. */
  deadline: string;
  startDate: string;
  endDate: string;
  status: 'DRAFT' | 'PUBLISHED' | 'CLOSED';
  createdAt: string;
  updatedAt: string;
}

/* ─────────────────────────── Notifications ─────────────────────────────── */

export type NotificationType =
  | 'BOOKING_CONFIRMED'
  | 'BOOKING_CANCELLED'
  | 'MENTOR_BOOKING_APPROVED'
  | 'MENTOR_BOOKING_REJECTED'
  | 'RECEIPT'
  | 'GENERAL';

export interface NotificationRecord {
  id: string;
  /** References UserRecord.id — the user who should see this notification */
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  /** Optional deep-link inside the app */
  href: string | null;
  read: boolean;
  createdAt: string;
}

/* ─────────────────────────── Mentor Consultations ─────────────────────────── */

/**
 * A paid/free mentor consultation booking (distinct from the admin-review
 * MentorBookingRecord which is the unauthenticated contact flow).
 *
 * Free quotas per month:
 *   ENTREPRENEUR  → 2 free 30-min sessions
 *   STARTUP       → 4 free 30-min sessions
 *   Other / none  → always charged 3 000 DZD
 */
export type ConsultationChargeType = 'FREE_QUOTA' | 'PAID';
export type ConsultationStatus = 'CONFIRMED' | 'CANCELLED';

export interface MentorConsultationRecord {
  id: string;
  mentorId: string;
  /** Cached mentor name for fast list rendering. */
  mentorName: string;
  userId: string;
  chargeType: ConsultationChargeType;
  /** Integer DZD. 0 when chargeType === 'FREE_QUOTA'. */
  amountCharged: number;
  /** References TransactionRecord.id, null when free. */
  transactionId: string | null;
  status: ConsultationStatus;
  /** "YYYY-MM" — used to count monthly free quota usage. */
  quotaMonth: string;
  /** Optional message from the user. */
  message: string;
  createdAt: string;
  updatedAt: string;
}

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
  mentorConsultations: MentorConsultationRecord[];
  savedStartups: SavedStartupRecord[];
  investorContacts: InvestorContactRecord[];
  investments: InvestmentRecord[];
  incubators: IncubatorRecord[];
  incubatorSpaces: IncubatorSpaceRecord[];
  incubatorPrograms: IncubatorProgramRecord[];
  incubatorEvents: IncubatorEventRecord[];
  userMemberships: UserMembershipRecord[];
  commissionRules: CommissionRuleRecord[];
  promoCodes: PromoCodeRecord[];
  auditLogs: AuditLogRecord[];
  platformSettings: PlatformSettingsRecord | null;
  notifications: NotificationRecord[];
  withdrawalRequests: WithdrawalRequestRecord[];
  /** CMS-managed landing page content. Null = use hard-coded defaults. */
  landingContent: LandingContent | null;
  /**
   * One-shot flags so first-run seeding / migrations never run twice.
   */
  meta: {
    mentorsSeeded?: boolean;
    /** Set after the 8 hardcoded demo mentor records are purged. */
    demoMentorsRemoved?: boolean;
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
  mentorConsultations: [],
  savedStartups: [],
  investorContacts: [],
  investments: [],
  incubators: [],
  incubatorSpaces: [],
  incubatorPrograms: [],
  incubatorEvents: [],
  userMemberships: [],
  commissionRules: [],
  promoCodes: [],
  auditLogs: [],
  platformSettings: null,
  notifications: [],
  withdrawalRequests: [],
  landingContent: null,
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
