/**
 * File-backed JSON store for auth state.
 *
 * Intended as a "mock" persistence layer until the real backend / Prisma
 * lands. It supports atomic writes (temp file + rename) and a single
 * in-process write queue so concurrent route handlers don't clobber each
 * other. Reads return deep clones so callers can't accidentally mutate
 * the cache.
 *
 * Stored under .data/auth.json (gitignored).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { UserRole, UserStatus } from '@/types/auth';
import type { LandingContent } from '@/types/cms';

// Vercel (and most serverless platforms) mount the project directory as
// read-only. Use /tmp instead, which is writable per-lambda.
// Note: /tmp is ephemeral — data resets on cold starts. This is acceptable
// for staging; swap the store for a real DB before going to production.
const DATA_DIR = process.env.VERCEL
  ? path.join('/tmp', '.data')
  : path.join(process.cwd(), '.data');
const DB_FILE = path.join(DATA_DIR, 'auth.json');

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
 * Booking ledger entry. The wallet transaction that paid for it is
 * referenced by `transactionId` so the two records stay linkable.
 */
export interface BookingRecord {
  id: string;
  userId: string;
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
  /** How the client intends to pay. Null for legacy/free bookings. */
  paymentMethod: PaymentMethod | null;
  /**
   * For manual / offline bookings only — the off-platform client's email.
   * Used to send them a receipt directly. Null for platform bookings
   * (those use the authenticated user's email instead).
   */
  clientEmail?: string | null;
  /**
   * Optional free-text notes added by the incubator for manual bookings.
   */
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ─────────────────────────── Contact ─────────────────────────── */

export interface ContactSubmissionRecord {
  id: string;
  name: string;
  email: string;
  message: string;
  createdAt: string;
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
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
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

/* ─────────────────────────── Incubators ─────────────────────────── */

export type IncubatorStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
export type IncubatorSubscription = 'COMMISSION' | 'FLAT';
export type IncubatorBillingCycle = 'SEMESTERLY' | 'YEARLY';
export type IncubatorSubscriptionStatus = 'ACTIVE' | 'NONE' | 'EXPIRED';

export interface IncubatorRecord {
  id: string;
  name: string;
  email: string;
  phone: string;
  city: string;
  status: IncubatorStatus;
  subscriptionCode: IncubatorSubscription;
  /** Billing cycle for FLAT plan. Null for COMMISSION plan. */
  billingCycle: IncubatorBillingCycle | null;
  /** Lifecycle of the active subscription period. */
  subscriptionStatus: IncubatorSubscriptionStatus;
  subscriptionPeriodStart: string | null;
  /** Next renewal date (when status is ACTIVE). */
  subscriptionPeriodEnd: string | null;
  subscriptionLastPaidAmount: number | null;
  /** Optional branding / legal fields used on PDF receipts. */
  logoUrl?: string | null;
  stampUrl?: string | null;
  address?: string | null;
  registrationNumber?: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ─────────────────────────── Promo Codes ─────────────────────────── */

export type PromoDiscountType = 'PERCENTAGE' | 'FIXED';

export interface PromoCodeRecord {
  id: string;
  /** Unique code string (stored uppercase) */
  code: string;
  discountType: PromoDiscountType;
  /** Percentage (0–100) for PERCENTAGE, integer DZD for FIXED */
  discountValue: number;
  /** null = unlimited uses */
  maxUses: number | null;
  useCount: number;
  validFrom: string;
  /** null = no expiry */
  validUntil: string | null;
  isActive: boolean;
  createdAt: string;
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
}

export const defaultPlatformConfig: PlatformConfig = {
  flatMonthlyPrice: 5_000,
  semesterlyMonths: 6,
  yearlyDiscountPercent: 30,
  commissionRate: 0.20,
};

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
  /**
   * One-shot flags and platform-wide config.
   */
  meta: {
    mentorsSeeded?: boolean;
    promoCodesSeeded?: boolean;
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
  meta: {},
};

let cache: DbShape | null = null;
let writeQueue: Promise<unknown> = Promise.resolve();

async function load(): Promise<DbShape> {
  if (cache) return cache;
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(DB_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<DbShape>;
    cache = { ...empty, ...parsed };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      cache = structuredClone(empty);
      await persist(cache);
    } else {
      throw err;
    }
  }
  return cache!;
}

async function persist(db: DbShape): Promise<void> {
  const tmp = `${DB_FILE}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(db, null, 2), 'utf8');
  await fs.rename(tmp, DB_FILE);
}

/**
 * Read a deep clone of the current DB. Safe to mutate — won't affect the cache.
 */
export async function read(): Promise<DbShape> {
  const db = await load();
  return structuredClone(db);
}

/**
 * Mutate the DB inside a serialized critical section, then persist.
 * The mutator may return a value, which becomes the resolved value.
 */
export async function update<T>(mutator: (db: DbShape) => T | Promise<T>): Promise<T> {
  const next = writeQueue.then(async () => {
    const db = await load();
    const result = await mutator(db);
    await persist(db);
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
