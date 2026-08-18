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
import type {
  UserRole,
  UserStatus,
  ApprovalStatus,
  BusinessSubType,
  IncubatorBusinessType,
} from '@/types/auth';
import type { LandingContent } from '@/types/cms';
import type { WeeklyAvailabilityDay } from '@/types/mentor';

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

  /** Biological sex as provided at signup. Optional — older accounts may lack this field. */
  sex?: 'MALE' | 'FEMALE' | null;

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

  // ─── Investor onboarding / approval extensions ──────────────────────────
  // Additive & nullable for backward compatibility. INVESTOR accounts created
  // after this feature land in 'PENDING_APPROVAL'; pre-existing investors lack
  // the key and are grandfathered as 'APPROVED' (see getInvestorApproval).
  // This is kept SEPARATE from `status` (which gates login) so a pending
  // investor can still sign in and reach the "awaiting approval" screen.

  /** Investor-specific approval gate. Unset ⇒ APPROVED for legacy investors. */
  investorStatus?: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';
  /** Optional LinkedIn profile URL/handle provided at investor signup. */
  linkedin?: string | null;
  /** Admin free-text reason captured when an investor is rejected. */
  investorRejectionReason?: string | null;

  // ─── Unified account-approval gate (read-only-until-approved) ───────────
  // Additive & nullable for backward compatibility. INCUBATOR / INVESTOR /
  // BUSINESS accounts created after this feature land in 'PENDING'; every other
  // role (and every pre-existing account, which lacks the key) is treated as
  // 'APPROVED' by getApprovalStatus(). This gates *write* access platform-wide
  // and is kept separate from `status` (which gates login) and from the legacy
  // per-surface gates (investorStatus, IncubatorRecord.status), which are kept
  // in sync by setAccountApproval() so all surfaces unlock together.

  /** Unified approval gate. Unset ⇒ APPROVED (legacy + entrepreneurs + admins). */
  approvalStatus?: ApprovalStatus;
  /** Admin free-text reason captured when an account is rejected (any gated role). */
  approvalRejectionReason?: string | null;

  // ─── Business account (role === 'BUSINESS') ─────────────────────────────
  // All optional. `businessSubType` discriminates trainer / training centre /
  // company; the rest are optional profile fields collected at signup.

  /** BUSINESS sub-type. Unset for non-business or legacy TRAINER pre-migration. */
  businessSubType?: BusinessSubType | null;
  /** Optional field / industry (free text). */
  businessIndustry?: string | null;
  /** Optional public website (URL-validated at signup when present). */
  businessWebsite?: string | null;
  /** Optional Instagram handle/URL. */
  businessInstagram?: string | null;
  /** Optional public-facing phone (distinct from the account login phone). */
  businessPhone?: string | null;
  /** Optional short description / bio. */
  businessDescription?: string | null;

  // ─── Payout account (manual withdrawals) ────────────────────────────────
  // Additive & nullable. The destination for bank/ccp withdrawal requests; it
  // is snapshotted onto each request at creation time. See [[PayoutAccount]].

  /** Payout account on file (RIB or CCP RIP + holder name). */
  payoutAccount?: PayoutAccount | null;

  // ─── Notification counts (read-only feature; this is its ONLY write) ────
  /**
   * Per-source "seen" map for the activity-count engine, keyed by the stable
   * source key (e.g. 'approvals', 'users' — see NOTIFICATION_SOURCES in
   * `@/server/notifications/activity-sources`) → ISO datetime of when the
   * user last opened that surface. Additive & nullable — absent key or absent
   * map means "never seen" ('view'-mode sources count from the beginning).
   * Written by key-merge only, never map replacement, so concurrent tabs
   * can't clobber sibling keys.
   */
  notificationsSeen?: Record<string, string> | null;
}

export interface SessionRecord {
  /** SHA-256 of the random session ID. The plaintext ID is only ever in the cookie. */
  idHash: string;
  userId: string;
  expiresAt: string;
  createdAt: string;
}

/** Channel an OTP was actually delivered through. */
export type OtpChannel = 'whatsapp' | 'sms' | 'email';

export interface OtpRecord {
  id: string;
  userId: string;
  /** HMAC-SHA256(code, AUTH_SECRET) — protects against DB-leak rainbow attacks */
  codeHash: string;
  expiresAt: string;
  attempts: number;
  consumed: boolean;
  /**
   * Which channel actually delivered this code (stamped after the send
   * succeeds). Additive & optional — absent on every OTP issued before the
   * sequential-fallback sender, and on any code whose delivery failed
   * outright.
   *
   * Consumed at verify time to decide WHICH contact detail this OTP proves:
   * a code that arrived on the phone verifies the phone; one that fell back
   * to email verifies the email and leaves the phone unverified.
   */
  channel?: OtpChannel;
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
  /** Optional incubator website (role === 'INCUBATOR'). Carried to IncubatorRecord. */
  website?: string;
  /** Optional incubator Instagram handle/URL (role === 'INCUBATOR'). */
  instagram?: string;
  /** Optional investor LinkedIn handle/URL (role === 'INVESTOR'). Carried to UserRecord. */
  linkedin?: string;
  /** Biological sex provided at signup. Optional. */
  sex?: 'MALE' | 'FEMALE';

  /**
   * Organisation kind chosen at INCUBATOR signup — optional. Copied to
   * `IncubatorRecord.businessType` on promotion; absent ⇒ null.
   */
  businessType?: IncubatorBusinessType;

  // ─── Business signup (role === 'BUSINESS') — all optional, carried to UserRecord ───
  // LEGACY: no longer collected at signup (the BUSINESS role was merged into
  // INCUBATOR). Retained so pending records written before the merge still parse.
  /** Was required at signup when role === 'BUSINESS'; absent otherwise. */
  businessSubType?: BusinessSubType;
  /** Optional field / industry. */
  businessIndustry?: string;
  /** Optional public website (URL-validated at signup). */
  businessWebsite?: string;
  /** Optional Instagram handle/URL. */
  businessInstagram?: string;
  /** Optional public-facing phone. */
  businessPhone?: string;
  /** Optional short description / bio. */
  businessDescription?: string;
  /**
   * "Book & create an account": a pointer to the booking this pending account
   * was created from. On OTP verify the booking is re-assigned to the new user
   * and the OTP form is redirected to the pay page (CARD → booking pay token)
   * or the dashboard (CONSULTATION → mentorBooking id, pay-after-approval).
   * Nullable / optional — normal signups never set it.
   */
  pendingBooking?: { kind: 'CARD' | 'CONSULTATION'; ref: string } | null;
}

/* ─────────────────────────── Wallet ─────────────────────────── */

/**
 * A user's wallet. Amounts are stored as **integer DZD** (no decimals)
 * to avoid floating-point drift. Convert to/from float only at display time.
 */
export interface WalletRecord {
  id: string;
  userId: string;
  /**
   * Integer DZD. Usually >= 0, but incubator wallets MAY go negative: a
   * CASH_DEPOSIT booking credits only the online deposit (+D) while debiting
   * the full platform commission (-C) on commission-based subscriptions, so
   * when C > D the running balance dips below zero. A negative balance is a
   * real debt the incubator must recharge before further payouts.
   */
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
  /**
   * What this intent funds. Absent ⇒ 'WALLET_TOPUP' (every record predating
   * this field is a plain wallet top-up), so legacy rows keep their meaning.
   * 'CONSULTATION' marks the shortfall top-up raised by the instant-book
   * wallet path — informational for admin/audit; settlement still runs through
   * confirmTopUp exactly as before.
   */
  purpose?: 'WALLET_TOPUP' | 'CONSULTATION';
  /**
   * Currency the payer was actually billed in. Absent ⇒ 'DZD'. Only ever 'EUR'
   * for a Stripe-funded intent; `amount` above stays the canonical integer DZD
   * in every case so the wallet ledger remains single-currency.
   */
  currency?: 'DZD' | 'EUR';
  /** Foreign-currency amount billed (EUR, 2dp). Null for DZD intents. */
  amountForeign?: number | null;
  /** Exchange rate frozen when the checkout session was created. Null for DZD. */
  exchangeRateApplied?: number | null;
  createdAt: string;
  updatedAt: string;
}

/* ─────────────────────────── Payment links ─────────────────────────── */

/**
 * Direct payment link — an incubator invoices a client (NO Metwork account
 * required for the payer) by sharing a public `/pay/<slug>` URL. Single-use:
 * once PAID the link can never be paid again.
 *
 * Money model mirrors an ONLINE_FULL card booking through the central commission
 * engine (src/server/payments/commission.ts). The payer is charged
 * `amount + payerFee` (default 2 % on top, frozen at payment init). At settlement
 * the incubator wallet moves +amount (PAYOUT) − receiverCommission (COMMISSION).
 * Incubators on an ACTIVE subscription (effective FLAT plan) pay NO receiver
 * commission, but their payers still pay the payer fee. Net credited = amount −
 * receiverCommission, always ≥ 0.
 *
 * Additive & backward-compatible: every field beyond the core set is optional
 * with a safe default, and the collection back-fills to [] via the read-merge.
 */
export type PaymentLinkStatus = 'ACTIVE' | 'PAID' | 'EXPIRED' | 'CANCELLED';

export interface PaymentLinkRecord {
  id: string;
  /** Owning incubator (IncubatorRecord.id). */
  incubatorId: string;
  /** What the client is paying for — shown on the public page + receipt. */
  serviceName: string;
  /** Integer DZD — the base amount the incubator invoices (fee added on top). */
  amount: number;
  description?: string | null;
  /** Unguessable, url-safe public identifier used in /pay/<slug>. */
  slug: string;
  status: PaymentLinkStatus;
  /** When true an `expiresAt` is set and enforced. */
  hasExpiry: boolean;
  expiresAt?: string | null;
  /** Captured on the public page when the payer initiates payment. */
  payerName?: string | null;
  payerEmail?: string | null;
  /** Provider transfer id (SlickPay) — set at payment init, polled to verify. */
  providerRef?: string | null;
  /** Payer-side fee frozen at payment init (default 2 % of amount). */
  payerFeeAmount?: number | null;
  payerFeeRate?: number | null;
  /** GROSS charged to the payer online = amount + payerFeeAmount. */
  grossChargedToPayer?: number | null;
  /** Receiver commission debited from the incubator wallet at settlement. */
  commissionAmount?: number | null;
  commissionRate?: number | null;
  /** Locale of the payer's pay page — drives receipt language + return URL. */
  locale?: string | null;
  /** Dedup stamps — claimed inside the settlement mutation. */
  paidReceiptSentAt?: string | null;
  incubatorNotifiedAt?: string | null;
  createdAt: string;
  paidAt?: string | null;
  updatedAt: string;
}

/* ─────────────────────────── Bookings ─────────────────────────── */

/**
 * Booking lifecycle.
 * Additive REQUEST-mode states (Airbnb-style "request to book"):
 * - 'AWAITING_APPROVAL' — request created, NO money moved, seat soft-held
 *   until the incubator approves/declines or the request expires.
 * - 'APPROVED_UNPAID'   — incubator approved; payment link active; still no
 *   money moved. Transitions to CONFIRMED on payment, or CANCELLED on expiry.
 * Expiry is represented as CANCELLED + declineReason ('approval_expired' /
 * 'payment_expired') — no separate EXPIRED status.
 */
export type BookingStatus = 'PENDING' | 'PENDING_PAYMENT' | 'AWAITING_APPROVAL' | 'APPROVED_UNPAID' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED' | 'REFUNDED';

/**
 * How a space accepts reservations.
 * - 'INSTANT' — pay at reservation, auto-confirmed (incubator credited
 *   immediately, no manual approval step).
 * - 'REQUEST' — free reservation request; incubator approves first, then the
 *   client pays via a tokenized payment link.
 * UNSET = legacy behavior preserved exactly: pay-at-reservation into escrow
 * (status PENDING), incubator approval confirms + credits. Modes are opt-in
 * per space.
 */
export type SpaceReservationMode = 'INSTANT' | 'REQUEST';
export type BookingItemKind = 'SPACE' | 'PROGRAM' | 'EVENT';
export type BookingUnit = 'HOUR' | 'HALF_DAY' | 'DAY' | 'MONTH';
/**
 * How a booking was paid for. Legacy values 'wallet' / 'manual' are kept
 * for backward compatibility; uppercase values are introduced alongside the
 * Network Pass and Partner Program features.
 */
export type BookingPaymentMethod =
  | 'wallet'
  | 'manual'
  | 'card'
  | 'NETWORK_PASS'
  | 'PROGRAM'
  | 'PARTNER_DISCOUNT';

/**
 * How a card-settled booking splits the total between an upfront online card
 * payment and cash collected off-platform.
 * - 'ONLINE_FULL'  — client paid the whole total T online by card.
 * - 'CASH_DEPOSIT' — client paid a deposit D online by card; the remaining
 *                    T − D is paid in cash to the incubator on site.
 * Unset for legacy wallet / manual / network-pass bookings.
 */
export type BookingPaymentMode = 'ONLINE_FULL' | 'CASH_DEPOSIT';

/**
 * Public-space "book before you sign up" selection carrier.
 *
 * A guest on a public space page picks a date/time + payment option and is sent
 * to signup/login. This DB-backed record carries ONLY that selection across the
 * signup+OTP (or login) round trip — it holds NO price and NO seat. The real,
 * server-priced card-booking intent is created at RESUME time (once the visitor
 * is authenticated) by `createCardBookingIntent`, so availability + pricing are
 * always re-validated against the live data, never the visitor's earlier read.
 * Short-lived (1h TTL); swept on write.
 */
export interface BookingIntentRecord {
  id: string;
  spaceId: string;
  unit: BookingUnit;
  startsAt: string;
  endsAt: string;
  paymentMode: BookingPaymentMode;
  /** Fixed 50/50 split for CASH_DEPOSIT when the listing has no configured deposit. */
  splitHalf?: boolean;
  createdAt: string;
  expiresAt: string;
}

/**
 * Payment lifecycle for a card-settled booking, independent of the booking's
 * scheduling `status`.
 * - 'AWAITING_CASH' — deposit paid online; the cash balance is still due.
 * - 'PAID'          — fully settled (online-full, or cash collected on site).
 */
export type BookingPaymentStatus = 'AWAITING_CASH' | 'PAID';

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
  /**
   * Consultant (MentorRecord.id) who booked this space from the consultant
   * portal. Additive & nullable — absent on every booking made by a platform
   * user or entered offline by an incubator.
   *
   * Consultants are a SEPARATE population with no `UserRecord` and no wallet,
   * so `userId` stays null on these rows and the contact details live in
   * `clientName` / `clientEmail` / `clientPhone` (same as an offline booking).
   * Consultant bookings are always CASH (`paymentMethod: 'manual'`) — the
   * consultant pays the space directly on site, so no money moves on Metwork.
   */
  mentorId?: string | null;
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

  /* ── Card-deposit / cash-lifecycle extensions (additive) ──────────────────
   * Present only on card-settled bookings (paymentMode set). Legacy wallet,
   * manual and network-pass bookings leave these undefined. Every amount is
   * recomputed and frozen SERVER-SIDE at settlement — never client-supplied. */

  /** Split model for this card booking. Unset for wallet/manual bookings. */
  paymentMode?: BookingPaymentMode;
  /** Amount actually paid online by card (D for CASH_DEPOSIT, T for ONLINE_FULL). */
  onlinePaidAmount?: number;
  /** Cash still due on site (T − D for CASH_DEPOSIT, 0 for ONLINE_FULL). */
  cashRemainingAmount?: number;
  /**
   * Receiver-side platform commission taken from the provider at settlement
   * (0 for FLAT/Pro subs). Central commission engine output. Historically this
   * was computed on the TOTAL; under the engine it is computed on the ONLINE
   * portion that flows through the platform (D for deposits, T for full).
   */
  commissionAmount?: number;
  /** Receiver commission rate snapshot at settlement (decimal 0–1). */
  commissionRate?: number;
  /**
   * Payer-side fee added ON TOP of the online portion and charged to the buyer
   * (integer DZD). Central commission engine output. Additive & nullable —
   * legacy bookings settled before the engine leave this undefined (⇒ 0).
   */
  payerFeeAmount?: number;
  /** Payer-fee rate snapshot at settlement (decimal 0–1). */
  payerFeeRate?: number;
  /**
   * Total charged to the buyer online by card = online base portion + payer
   * fee. Additive & nullable — when absent, callers fall back to
   * onlinePaidAmount (legacy, fee-free).
   */
  onlineChargeAmount?: number;
  /** Payment lifecycle. 'AWAITING_CASH' after deposit; 'PAID' once settled. */
  paymentStatus?: BookingPaymentStatus;
  /** Idempotency stamp — set once the wallet settlement has been applied. */
  settledAt?: string | null;

  /** Cash-collection audit — who/when the incubator marked the balance paid. */
  cashCollectedAt?: string | null;
  cashCollectedBy?: string | null;

  /** Receipt dedup guards — interim deposit receipt and final paid receipt. */
  depositReceiptSentAt?: string | null;
  finalReceiptSentAt?: string | null;
  /**
   * Dedup guard — operator refund alert sent for a card booking that was paid
   * online but VOIDED because the slot was taken at settlement
   * (declineReason SLOT_TAKEN_AFTER_PAYMENT). Nullable/additive: legacy records
   * have no stamp and behave as "not yet alerted".
   */
  refundAlertSentAt?: string | null;

  /* ── Hosted-checkout intent (guest + registered card flows) ───────────── */
  /** Single-use token addressing this PENDING_PAYMENT intent on the pay page. */
  payToken?: string | null;
  /** ISO expiry for payToken. */
  payTokenExpiresAt?: string | null;
  /** Provider transfer id, recorded lazily at checkout init; polled on return. */
  paymentProviderRef?: string | null;
  /** Locale to render the hosted-checkout return + receipts in. */
  bookingLocale?: string | null;

  /* ── REQUEST-mode reservation (approve-then-pay) — all additive ────────
   * Present only on bookings created against a space with a reservationMode
   * set. Legacy bookings leave every field undefined and behave exactly as
   * before. */

  /**
   * Space's reservation mode SNAPSHOTTED at creation, so a later change of
   * the space setting never mutates an in-flight booking's lifecycle.
   */
  reservationMode?: SpaceReservationMode;
  /** Set when the incubator approves a REQUEST booking (idempotency guard). */
  approvedAt?: string | null;
  /** Set when the wallet charge settles (idempotency guard — set = no-op replay). */
  paidAt?: string | null;
  /** SHA-256 hex of the single-use payment-link token (raw token only in email). */
  paymentLinkTokenHash?: string | null;
  /** ISO expiry of the payment link; past it the booking is swept to CANCELLED. */
  paymentLinkExpiresAt?: string | null;

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

export type IncubatorStatus = 'PENDING' | 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'REJECTED';
export type IncubatorSubscription = 'COMMISSION' | 'FLAT';
export type IncubatorBillingCycle = 'MONTHLY' | 'YEARLY';
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
  /**
   * Provider discriminator. Additive & nullable for backward compatibility:
   * missing/null ⇒ 'INCUBATOR' (every pre-existing record and all managerId
   * lookups keep working unchanged). 'BUSINESS' marks a trainer / training
   * centre / company that can post programs & events and receive payments,
   * but cannot manage spaces and has no subscription plan. 'TRAINER' is the
   * legacy value for pre-migration records (treated identically to 'BUSINESS').
   */
  providerType?: 'INCUBATOR' | 'TRAINER' | 'BUSINESS';
  /**
   * Account-level provider category — what KIND of organisation this is.
   *
   * Additive & nullable: absent/null on every record created before the
   * Business→Incubator merge, and readers must treat that as "unset" (falling
   * back to the generic "Incubator" label). Purely INFORMATIONAL — it never
   * gates permissions; a TRAINING_CENTER has exactly the same capabilities as
   * an INCUBATOR or a COWORKING_SPACE.
   *
   * Distinct from `SpaceCategory` (@/types/domain), which classifies an
   * individual bookable space listing, not the account that owns it.
   */
  businessType?: IncubatorBusinessType | null;
  status: IncubatorStatus;
  website?: string | null;
  /** Instagram handle or full profile URL provided at registration. Nullable. */
  instagram?: string | null;
  /** Admin free-text reason captured when the incubator is rejected. Nullable. */
  rejectionReason?: string | null;
  /**
   * Soft-archive marker. When set, the incubator + its listings are hidden from
   * every public surface, the owner's login is blocked, and it is excluded from
   * admin default lists — but all financial history (wallet, transactions,
   * bookings, invoices) is preserved. Cleared on restore. Additive & nullable.
   */
  archivedAt?: string | null;
  /** Billing model — legacy alias. Prefer subscriptionCode. */
  subscriptionTier?: 'COMMISSION' | 'FLAT';
  /** Billing model: 'COMMISSION' = platform takes a cut; 'FLAT' = periodic fee. */
  subscriptionCode?: IncubatorSubscription;
  billingCycle?: IncubatorBillingCycle | null;
  subscriptionStatus?: IncubatorSubscriptionStatus;
  subscriptionPeriodStart?: string | null;
  subscriptionPeriodEnd?: string | null;
  subscriptionLastPaidAmount?: number | null;
  /**
   * ISO timestamp of the first-ever Pro (FLAT) activation. Set once and never
   * cleared — guarantees the one-month free trial is granted only once.
   */
  proTrialUsedAt?: string | null;
  logoUrl?: string | null;
  stampUrl?: string | null;
  /** Physical / postal address — printed on receipts. */
  address?: string | null;
  /** Commercial register number (RC in Algeria). */
  commercialRegNumber?: string | null;
  registrationNumber?: string | null;
  /** Tax identification number (NIF in Algeria). */
  nif?: string | null;
  /**
   * Invoice header + settings — additive & nullable. `nis` / `ai` complete the
   * Algerian legal header (RC/NIF already exist above); `contactEmail`,
   * `contactPhone` and the existing `website` feed the invoice footer.
   */
  nis?: string | null;
  /** Article d'Imposition (printed as "Art N" on invoices). */
  ai?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  /** Default VAT % applied to new invoices. Null/unset ⇒ 19. */
  defaultVatRate?: number | null;
  /** Preferred invoice PDF template. Null/unset ⇒ 'CLASSIC'. */
  invoiceTemplate?: InvoiceTemplate | null;
  /**
   * Bank details printed on VIREMENT invoices (required to issue one).
   * bankRib = the 20-digit Algerian RIB / account number.
   */
  bankName?: string | null;
  bankRib?: string | null;
  /**
   * Per-year invoice sequence counters, e.g. { "2026": 12 } — the last seq
   * issued for that year. Mutated ONLY inside db.update() via
   * allocateInvoiceNumber() so concurrent creates can't collide.
   */
  invoiceCounters?: Record<string, number> | null;
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
  | 'INCUBATOR_APPROVED'
  | 'INCUBATOR_REJECTED'
  | 'INCUBATOR_ARCHIVED'
  | 'INCUBATOR_RESTORED'
  | 'INVESTOR_APPROVED'
  | 'INVESTOR_REJECTED'
  | 'ACCOUNT_APPROVED'
  | 'ACCOUNT_REJECTED'
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
  | 'PAYOUT_BANK_ACCOUNT_SET'
  | 'PAYOUT_SENT'
  | 'ACCOUNT_DELETED'
  | 'MENTOR_APPROVED'
  | 'MENTOR_REJECTED'
  | 'MENTOR_PUBLISHED'
  | 'MENTOR_UNPUBLISHED';

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
  /**
   * Public landing-section visibility, keyed by section id (see
   * LANDING_SECTIONS in `@/lib/landing-visibility`). Additive & nullable —
   * a missing map or missing key means VISIBLE. `false` hides the section
   * from the public nav AND 404s its routes server-side.
   */
  landingVisibility?: Record<string, boolean> | null;
  /**
   * DZD per 1 EUR, used ONLY to price the Stripe (Visa/Mastercard) hosted
   * checkout for consultations. Admin-editable. Null/absent ⇒ international
   * card payment is unavailable (fail-closed: we never guess a rate).
   *
   * The rate is snapshotted onto the booking + top-up intent at checkout-session
   * creation, so changing it here never retroactively affects an in-flight or
   * already-paid transaction.
   */
  eurToDzdRate?: number | null;
  eurToDzdRateUpdatedAt?: string | null;
  /** UserRecord.id of the admin who last changed the rate. */
  eurToDzdRateUpdatedBy?: string | null;
  updatedAt: string;
}

/* ─────────────────────────── Startup Marketplace ───────────────── */

export type StartupListingStatus = 'DRAFT' | 'ACTIVE' | 'CLOSED';

/** Founder-selected maturity stage. No default — the founder must actively choose one. */
export type StartupMaturityStage =
  | 'IDEA'
  | 'PROTOTYPE_MVP'
  | 'PRE_SEED'
  | 'SEED'
  | 'SERIES_A'
  | 'GROWTH';

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
  /**
   * Optional for backward compat — old records lack this field. No default
   * value is ever assigned; null means the founder hasn't chosen one yet.
   */
  maturityStage?: StartupMaturityStage | null;
  /**
   * Optional for backward compat — old records lack this field. Cloudinary
   * (or disk-fallback) URL of the uploaded pitch deck PDF.
   */
  pitchDeckUrl?: string | null;
  /** Optional for backward compat — old records lack this field. URL-validated when present. */
  websiteUrl?: string | null;
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
  /** Ordered gallery; imageUrls[0] is the cover and is kept in sync with imageUrl. Additive — legacy records lack this. */
  imageUrls?: string[];
  pricePerHour: number | null;
  pricePerDay: number | null;
  pricePerMonth: number | null;
  /**
   * Optional flat HALF-DAY price (integer DZD) + the incubator-configured
   * half-day window ("HH:MM"). Additive & nullable: when pricePerHalfDay is set
   * the listing offers a "Half day" booking for the [halfDayStart, halfDayEnd)
   * window at this flat price. Legacy records lack these and offer no half-day.
   */
  pricePerHalfDay?: number | null;
  halfDayStart?: string;
  halfDayEnd?: string;
  /**
   * Optional CASH-booking per-unit prices (integer DZD). Additive & nullable:
   * when set, a CASH (deposit + cash-on-site) booking is priced from these;
   * when absent, it falls back to the matching pricePer* above — so legacy
   * listings keep their single price for both online and cash. The online-card
   * (ONLINE_FULL) booking always uses pricePer* above.
   */
  cashPricePerHour?: number | null;
  cashPricePerHalfDay?: number | null;
  cashPricePerDay?: number | null;
  cashPricePerMonth?: number | null;
  capacity: number;
  amenities: string[];
  /**
   * Accepted client payment methods (single source of truth for online/cash
   * enablement). 'CASH' here means "card deposit now + cash on site"; when set,
   * cashDepositType/Value below define the required deposit.
   */
  acceptedPaymentMethods: PaymentMethod[];
  /** Deposit model for CASH bookings. Unset = legacy listing (no deposit configured). */
  cashDepositType?: 'FIXED' | 'PERCENT';
  /** Deposit value: integer DZD when FIXED, or 1–100 when PERCENT. */
  cashDepositValue?: number;
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
  /** ISO date strings (YYYY-MM-DD) when this space is unavailable (full-day blocks). */
  unavailableDates?: string[];
  /**
   * Airbnb-style blackouts. Each entry blocks one date for EVERYONE (public,
   * guest, and the incubator's own manual bookings) until removed. When `from`
   * and `to` (both "HH:MM") are present the block covers only that time range on
   * that date; otherwise the whole day is blocked. Additive & nullable — legacy
   * records lack this and keep using `unavailableDates` for full-day blocks.
   */
  blackouts?: { date: string; from?: string; to?: string }[];
  /**
   * Per-space duration discounts, configured by the incubator. Each rule grants
   * `percent`% off once the booking reaches `minQty` units of `unit`
   * (e.g. { unit:'DAY', minQty:3, percent:10 } = "3+ days → 10% off";
   *        { unit:'HOUR', minQty:20, percent:15 } = "20+ hours → 15% off").
   * Applied SERVER-SIDE to the online/card price (never the operator-entered
   * manual-booking amount). Additive & nullable — defaults to no discount.
   */
  durationDiscounts?: { unit: 'HOUR' | 'DAY'; minQty: number; percent: number }[];
  /**
   * How this space accepts reservations (see SpaceReservationMode). Additive &
   * nullable — UNSET keeps the legacy pay-escrow-then-approve flow untouched.
   */
  reservationMode?: SpaceReservationMode;
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
   * denormalised so the public spaces filter can avoid a join. In the
   * per-incubator model this also requires `networkBookable` to be on.
   */
  isPartnerInNetwork?: boolean;
  /**
   * Per-space opt-in toggle for the per-incubator Partner Program. When the
   * owning incubator is enrolled, each space can be individually included or
   * excluded from network bookings. Defaults by category when unset:
   * COWORKING / TRAINING_ROOM / DOMICILIATION ⇒ true, PRIVATE_OFFICE ⇒ false.
   * Additive & nullable — legacy records lack it and fall back to the default.
   */
  networkBookable?: boolean;

  // ─── Category-specific extensions (additive & nullable) ────────────────
  // Each block applies to one SpaceCategory. All are optional so legacy
  // records keep working unchanged; readers default to [] / null.
  /**
   * COWORKING — individually named/numbered desks, each independently
   * bookable per day (e.g. ["Desk 01","Desk 02","A3"]). Desk-level
   * availability is computed from `deskBookings`. Default ⇒ [].
   */
  deskNames?: string[];
  /**
   * PRIVATE_OFFICE — gallery + metadata for the single bookable office unit.
   * `officeSize` is in m². Defaults ⇒ [] / null / [].
   */
  officePhotos?: string[];
  officeSize?: number | null;
  officeFloor?: string | null;
  officeAmenities?: string[];
  /**
   * DOMICILIATION — no calendar booking. Total number of address slots the
   * incubator offers; requests are collected via `domiciliationRequests` and
   * handled offline. Default ⇒ null (unset = not a domiciliation listing).
   */
  domiciliationSlots?: number | null;
}

export interface ProgramRecord {
  id: string;
  /**
   * Owning incubator (IncubatorRecord.id), or null when this program is owned
   * by a consultant instead — see `mentorId` below. Widened from `string` to
   * `string | null` by the consultant-programs work: every record written
   * before that change carries a real id, so nothing needs migrating and every
   * existing `p.incubatorId === inc.id` filter keeps behaving identically
   * (null never matches a real id, so consultant programs are excluded from
   * incubator-scoped queries automatically).
   *
   * EXACTLY ONE of `incubatorId` / `mentorId` is set. Resolve ownership through
   * `@/server/programs/ownership` rather than reading these fields directly.
   */
  incubatorId: string | null;
  /** Denormalized owning-incubator name. Empty string on consultant-owned rows. */
  incubatorName: string;
  /**
   * Owning consultant (MentorRecord.id). Additive & nullable — absent on every
   * program created by an incubator or the admin.
   *
   * Consultants are a SEPARATE population with no `UserRecord` (see
   * `MentorRecord` / `@/server/mentors/access`), so these rows can never be
   * authorized through the incubator `managerId → session user` path. Mirrors
   * the same pattern already shipped on `BookingRecord.mentorId`.
   */
  mentorId?: string | null;
  /** Denormalized owning-consultant name, shown as the public host/branding. */
  mentorName?: string | null;
  title: string;
  description: string;
  type: ProgramType;
  city: string;
  imageUrl: string | null;
  /** Ordered gallery; imageUrls[0] is the cover and is kept in sync with imageUrl. Additive — legacy records lack this. */
  imageUrls?: string[];
  price: number;
  /**
   * Optional split pricing (integer DZD). Additive & nullable: when set, an
   * ONLINE_FULL booking is priced from onlinePrice and a CASH (deposit +
   * cash-on-site) booking from cashPrice. When either is absent it falls back
   * to `price`, so legacy programs keep a single price for both surfaces.
   */
  onlinePrice?: number | null;
  cashPrice?: number | null;
  seatsTotal: number;
  deadline: string;
  startDate: string;
  endDate: string;
  acceptedPaymentMethods: PaymentMethod[];
  /** Deposit model for CASH bookings. Unset = legacy listing (no deposit configured). */
  cashDepositType?: 'FIXED' | 'PERCENT';
  /** Deposit value: integer DZD when FIXED, or 1–100 when PERCENT. */
  cashDepositValue?: number;
  isActive: boolean;
  /**
   * SEO-friendly URL slug, e.g. "startup-bootcamp-oran-2025".
   * Optional for backward compat — old records lack this field.
   * Unique per incubator (enforced in API layer).
   */
  slug?: string | null;
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
  /** Ordered gallery; imageUrls[0] is the cover and is kept in sync with imageUrl. Additive — legacy records lack this. */
  imageUrls?: string[];
  price: number;
  /**
   * Optional split pricing (integer DZD). Additive & nullable: when set, an
   * ONLINE_FULL booking is priced from onlinePrice and a CASH (deposit +
   * cash-on-site) booking from cashPrice. When either is absent it falls back
   * to `price`, so legacy events keep a single price for both surfaces.
   */
  onlinePrice?: number | null;
  cashPrice?: number | null;
  isOnline: boolean;
  capacity: number;
  eventDate: string;
  acceptedPaymentMethods: PaymentMethod[];
  /** Deposit model for CASH bookings. Unset = legacy listing (no deposit configured). */
  cashDepositType?: 'FIXED' | 'PERCENT';
  /** Deposit value: integer DZD when FIXED, or 1–100 when PERCENT. */
  cashDepositValue?: number;
  isActive: boolean;
  /**
   * SEO-friendly URL slug, e.g. "ai-founders-meetup-oran".
   * Optional for backward compat — old records lack this field.
   * Unique per incubator (enforced in API layer).
   */
  slug?: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ─────────────────────────── Registration System ─────────────────────────── */

/** Supported field types for the dynamic registration form builder. */
export type RegistrationFieldType =
  | 'SHORT_TEXT'
  | 'LONG_TEXT'
  | 'DROPDOWN'
  | 'MULTIPLE_CHOICE'
  | 'CHECKBOX'
  | 'PHONE'
  | 'EMAIL'
  | 'URL';

/**
 * One custom field definition for a program or event's registration form.
 * Incubators create/edit these via the form builder in their dashboard.
 */
export interface RegistrationFormFieldRecord {
  id: string;
  entityType: 'PROGRAM' | 'EVENT';
  entityId: string;
  incubatorId: string;
  label: string;
  type: RegistrationFieldType;
  /** For DROPDOWN / MULTIPLE_CHOICE / CHECKBOX — the list of choices. */
  options: string[] | null;
  required: boolean;
  /** Display order (0-indexed). */
  order: number;
  createdAt: string;
  updatedAt: string;
}

/** Status of a registration. */
export type RegistrationStatus = 'CONFIRMED' | 'WAITLISTED' | 'CANCELLED';

/**
 * One registration by a guest or authenticated user for a program or event.
 * Separate from BookingRecord — no wallet transaction is required.
 */
export interface RegistrationRecord {
  id: string;
  entityType: 'PROGRAM' | 'EVENT';
  entityId: string;
  incubatorId: string;
  /** Null for guest (no-account) registrations. */
  userId: string | null;
  fullName: string;
  email: string;
  phone: string;
  /** Answers to custom form fields. */
  answers: Array<{ fieldId: string; value: string | string[] }>;
  status: RegistrationStatus;
  /** FK to ClientRecord.id — set when a CRM client was matched or created. */
  clientId: string | null;
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
  /**
   * IncubatorRecord.id this enrolment belongs to (per-incubator model). The
   * Partner Program is configured per-incubator: one active record per
   * incubator, with per-space opt-in via SpaceRecord.networkBookable.
   * Additive & nullable for backward compatibility — legacy per-space records
   * have only `spaceId`; the one-time migration sets `incubatorId` on a
   * consolidated canonical record per incubator.
   */
  incubatorId?: string | null;
  /**
   * SpaceRecord.id this enrolment belonged to in the legacy per-space model.
   * Now optional: incubator-level records leave this null. Kept for history.
   */
  spaceId?: string | null;
  /** Set on legacy per-space records superseded by the per-incubator migration. */
  supersededByIncubatorId?: string | null;
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

/* ─────────────────────── Partner Perks ─────────────────────── */

/**
 * Minimum membership tier required to claim a perk. Reuses the paid-tier
 * vocabulary of the Network Pass system ('BUILDER' | 'FOUNDER'); the legacy
 * membershipCode values map through the perks service's single rank table
 * (ENTREPRENEUR ≡ BUILDER, STARTUP ≡ FOUNDER — see meetsMinTier()).
 */
export type PerkMinTier = 'BUILDER' | 'FOUNDER';

/**
 * How a claimed perk is fulfilled:
 * - 'CODE_POOL' — partner-issued promo codes bulk-loaded by an admin; a claim
 *   assigns the first AVAILABLE PromoCodePoolEntryRecord to the user.
 * - 'VOUCHER'   — Metwork-issued voucher (VoucherRecord) with a public
 *   verification page; validity is computed LIVE from the holder's current
 *   membership, never stored.
 */
export type PerkFulfillmentType = 'CODE_POOL' | 'VOUCHER';

/**
 * An admin-created partner perk claimable by Builder+ subscribers.
 * All logic lives in src/server/perks/service.ts (single canonical module).
 */
export interface PerkRecord {
  id: string;
  partnerName: string;
  logoUrl: string | null;
  title: string;
  description: string;
  fulfillmentType: PerkFulfillmentType;
  minTier: PerkMinTier;
  /**
   * CODE_POOL only — when the AVAILABLE count drops below this, an admin
   * low-stock email fires (once per depletion cycle). Null = never notify.
   */
  lowStockThreshold: number | null;
  /**
   * ISO datetime of the last low-stock email for the current depletion cycle.
   * Set inside the claim lock (prevents duplicate sends); cleared back to
   * null when new codes are added to the pool.
   */
  lowStockNotifiedAt: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * One partner-issued promo code in a CODE_POOL perk's pool.
 * Uniqueness of `code` is enforced per-perk in the service layer.
 */
export interface PromoCodePoolEntryRecord {
  id: string;
  /** PerkRecord.id. Indexed. */
  perkId: string;
  code: string;
  status: 'AVAILABLE' | 'ASSIGNED';
  /** UserRecord.id of the claimer. Null while AVAILABLE. */
  assignedToUserId: string | null;
  assignedAt: string | null;
  createdAt: string;
}

/**
 * Metwork-issued voucher for a VOUCHER perk. Carries NO expiry — validity is
 * computed live at verification time from the holder's CURRENT membership
 * (see verifyVoucher()). Re-claims supersede the previous voucher.
 */
export interface VoucherRecord {
  id: string;
  /** PerkRecord.id. Indexed. */
  perkId: string;
  /** UserRecord.id of the holder. Indexed. */
  userId: string;
  /** Short human-typeable code, "MTW-" + 6 alphanumerics. Collision-checked. */
  code: string;
  issuedAt: string;
  /** True once replaced by a newer voucher for the same user+perk. */
  superseded: boolean;
  createdAt: string;
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

/**
 * Booking lifecycle.
 *
 * Registered (wallet-paid) flow: PENDING → APPROVED | REJECTED.
 * Guest (pay-after-approval) flow: PENDING → AWAITING_PAYMENT → CONFIRMED,
 * or PENDING → REJECTED. AWAITING_PAYMENT/CONFIRMED are additive and only
 * ever apply to guest bookings — the registered path is unchanged.
 */
/**
 * Consultation booking status.
 *
 * Legacy (admin-approval era — retained so existing rows & reports keep working):
 *   PENDING | APPROVED | REJECTED | AWAITING_PAYMENT | CONFIRMED
 *
 * Target (instant-book, pay-first lifecycle — emitted by the new flow in later
 * prompts; defined here so the type system and UI maps are ready):
 *   PENDING_PAYMENT — booking created, awaiting the pay-first charge to settle.
 *   AWAITING_LINK   — paid & confirmed, but the consultant has not provided a
 *                     meeting link yet (no profile default).
 *   READY           — paid + a meeting link/format is set; the session can happen.
 *   COMPLETED       — the session took place (releases the held mentor earning).
 *   CANCELLED       — cancelled before completion (refund per policy).
 */
export type MentorBookingStatus =
  // ── Legacy ──
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'AWAITING_PAYMENT'
  | 'CONFIRMED'
  // ── Target (instant-book, pay-first) ──
  | 'PENDING_PAYMENT'
  | 'AWAITING_LINK'
  | 'READY'
  | 'COMPLETED'
  | 'CANCELLED';

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
  /**
   * ID of the COMPLETED `TransactionRecord` that debited the user's wallet
   * when this booking was created (PAID only). Null for FREE_QUOTA and for
   * legacy bookings created before the wallet-debit fix. Used by the admin
   * reject flow to issue a refund.
   */
  transactionId?: string | null;
  /**
   * ID of the REFUND transaction issued when an admin rejected a PAID
   * booking. Null until rejection (or never set for FREE_QUOTA bookings).
   */
  refundTransactionId?: string | null;
  /**
   * Idempotency key supplied by the client (random UUID). Prevents
   * double-charging on network retries — a second POST with the same
   * (userId, clientReference) replays the original booking instead of
   * creating a new one.
   */
  clientReference?: string | null;

  /* ── Guest (pay-after-approval) flow. All additive & optional. ──────────
   * Absent on registered (wallet) bookings, which keep their existing
   * shape untouched. */

  /**
   * Booking origin. 'registered' = authenticated wallet booking (existing
   * behaviour, paid at booking). 'guest' = unauthenticated request that
   * pays online via the hosted checkout AFTER admin approval. Absent ⇒
   * 'registered' (legacy bookings predate this field).
   */
  source?: 'registered' | 'guest';
  /**
   * Payment state for the guest flow (registered bookings track money via
   * transactionId/refundTransactionId instead).
   *   UNPAID           — guest request created, not yet approved.
   *   AWAITING_PAYMENT — admin approved, pay link emailed, not yet paid.
   *   PAID             — guest completed hosted checkout (settled).
   */
  paymentStatus?: 'UNPAID' | 'AWAITING_PAYMENT' | 'PAID';
  /**
   * Unguessable single-use token embedded in the public pay URL
   * (/consultation/pay/[token]). Cleared once payment settles so the link
   * cannot be replayed.
   */
  payToken?: string | null;
  /** ISO expiry for payToken (7 days from approval). */
  payTokenExpiresAt?: string | null;
  /**
   * Hosted-checkout provider reference (SlickPay transfer id) for the guest
   * payment. Used to verify payment status server-side on return — never
   * trusting the redirect.
   */
  paymentProviderRef?: string | null;
  /**
   * How this consultation is/was paid — chosen by the client at checkout and
   * frozen at booking creation. Drives which settler owns the booking:
   *   WALLET   — balance debit now, or a top-up of the shortfall then a debit
   *              (settleMemberTopUp, keyed on topUpIntentId).
   *   SLICKPAY — direct CIB/Edahabia hosted charge for the full amount
   *              (direct-payment.ts, keyed on payToken / booking id).
   *   STRIPE   — direct Visa/Mastercard hosted charge, billed in EUR at the
   *              rate frozen below. Same settler as SLICKPAY.
   * Absent on legacy bookings: guest records behave as a direct charge,
   * registered records as WALLET (see resolveBookingPaymentProvider).
   */
  paymentProvider?: 'SLICKPAY' | 'STRIPE' | 'WALLET' | 'CASH';
  /**
   * FX audit pair for a STRIPE-paid consultation. `amountCharged` stays the
   * canonical integer DZD everywhere; these record what the payer's card was
   * actually billed and the rate frozen at checkout-session creation, so a
   * later admin rate change can never rewrite history.
   *
   * WRITE-ONLY as far as the product is concerned: no consultant-facing view,
   * payout ledger, receipt or notification may read these. Audit/admin only.
   */
  stripeAmountEur?: number | null;
  stripeRateApplied?: number | null;
  /**
   * Linked wallet TopUpIntentRecord id for the instant-book "wallet-first,
   * SlickPay top-up" member flow: when a member has insufficient balance, a
   * top-up is initiated and its id stored here so the return verification can
   * confirm it and then settle the booking from the (now-funded) wallet.
   * Null for guest (SlickPay-direct) and fully-funded member bookings.
   */
  topUpIntentId?: string | null;
  /**
   * True for bookings created by the instant-book, pay-first flow. Gates the
   * consultant earnings credit at settlement: only instant-book bookings credit
   * the mentor ledger. Absent on legacy (admin-approval) bookings, which must
   * never credit it.
   */
  instantBook?: boolean;
  /**
   * Confirmed session format for an instant-book booking, resolved from the
   * consultant's defaults at settlement (or set later when they supply a link).
   * Distinct from the legacy `meetLink`/`isOffline` admin fields.
   */
  meetingMode?: 'ONLINE' | 'OFFLINE' | null;
  /** Online meeting URL for an instant-book booking. Null for OFFLINE / not-yet-set. */
  meetingLink?: string | null;
  /**
   * In-person address for an OFFLINE instant-book booking, supplied by the
   * consultant (or from their default). Delivered to the client in the
   * "session ready" notification. Null for ONLINE / not-yet-set.
   */
  meetingAddress?: string | null;
  /** Google Maps link for the in-person address. Null for ONLINE / not-yet-set. */
  meetingMapsLink?: string | null;
  /**
   * Origin of the current `meetingLink`/`meetingMode`: 'auto' — Zoom API
   * auto-generated the meeting at settlement (no consultant default set);
   * 'manual' — the consultant (or admin on their behalf) supplied it via
   * `setBookingMeetingLink`; 'offline' — in-person, no link involved. Null
   * for legacy bookings predating auto-generation.
   */
  meetingSource?: 'auto' | 'manual' | 'offline' | null;
  /** Zoom join URL, set alongside `meetingLink` when `meetingSource === 'auto'`. */
  zoomJoinUrl?: string | null;
  /** Zoom host start URL (auto-signs the consultant in as host) — 'auto' only. */
  zoomStartUrl?: string | null;
  /** Zoom meeting id — checked before creating a meeting to avoid duplicates on retry. */
  zoomMeetingId?: string | null;
  /**
   * Set when the session is marked COMPLETED — the transition that releases the
   * consultant's held (PENDING) earning to AVAILABLE.
   */
  completedAt?: string | null;
  /**
   * Dedup stamp: set once the "session ready" notification (meeting details) has
   * been dispatched to the client, so reaching READY more than once (settle →
   * link update) never re-notifies.
   */
  linkSentAt?: string | null;
  /**
   * Dedup stamp: set once the "booking received" notification has been
   * dispatched (consultant + client), so re-processing a booking never
   * re-notifies. Distinct from `linkSentAt` (the session-ready notice).
   */
  bookingNotifiedAt?: string | null;
  /**
   * Final integer DZD the guest must pay, recomputed server-side at approval
   * (mentor fee × confirmed duration − validated promo). Distinct from
   * amountCharged so the guest amount is auditable independent of any legacy
   * indicative value.
   */
  guestAmountDue?: number | null;
  /**
   * Set once the post-payment confirmation emails (client + mentor) have been
   * dispatched, so re-verifying a settled booking never re-sends them.
   */
  confirmationEmailSentAt?: string | null;
  /**
   * Dedup stamp: set once the "request received" acknowledgment email has been
   * dispatched to the CLIENT (fired when a booking is created/settled without
   * immediate meeting details — READY bookings get the session-ready email
   * instead). Distinct from `confirmationEmailSentAt` (guest payment receipt).
   */
  requestReceivedEmailSentAt?: string | null;
  /**
   * Dedup stamp: set once the pre-session reminder email (meeting link /
   * "add your link" nudge) has been dispatched to the CONSULTANT by the
   * consultation-reminders cron. One reminder per booking, ever.
   */
  consultantReminderSentAt?: string | null;
  /**
   * Dedup stamp: set once the 1h-before reminder (email + WhatsApp→SMS with
   * the meeting details) has been dispatched to the CLIENT by the
   * consultation-reminders cron. One reminder per booking, ever.
   */
  clientReminderSentAt?: string | null;
  /**
   * Locale the guest used when requesting (en|fr|ar). Drives the pay-link
   * email language and the locale segment of the public pay URL. Absent on
   * registered bookings (their language comes from the user record).
   */
  guestLocale?: 'en' | 'fr' | 'ar';

  /* ── Promo-split / platform-subsidy accounting (P3). All additive & nullable. ──
   * The consultant's earning is computed on the FULL, undiscounted base price B
   * (fee × duration, before tier AND promo); the platform absorbs every
   * discount (subsidize model). These fields freeze the breakdown at booking
   * time so settlement + admin P&L read one source of truth and never recompute. */

  /**
   * Absolute base price B in DZD = `computePrice(fee, duration)` BEFORE the
   * membership-tier and promo discounts. The consultant's share is
   * `round(B × mentorRate)`. Null on legacy bookings / free sessions ⇒ the
   * ledger falls back to the collected gross (old behaviour).
   */
  consultantShareBase?: number | null;
  /** DZD removed by the membership tier — absorbed by the platform. Audit only. */
  tierDiscountAmount?: number | null;
  /** DZD removed by the promo code — absorbed by the platform. Audit only. */
  promoDiscountAmount?: number | null;

  /* ── Reschedule / cancel (P3). All additive & nullable. ─────────────────── */

  /** Times this booking has been rescheduled (cap enforced by the validator). */
  rescheduleCount?: number | null;
  /** ISO timestamp of the most recent reschedule. */
  rescheduledAt?: string | null;
  /** Append-only audit of every reschedule (oldest → newest). */
  rescheduleHistory?: Array<{
    from: { date: string | null; time: string | null; scheduledAt: string | null };
    to: { date: string | null; time: string | null; scheduledAt: string | null };
    by: 'consultant' | 'user' | 'admin';
    at: string;
  }> | null;
  /** ISO timestamp the booking was CANCELLED. */
  cancelledAt?: string | null;
  /** Who initiated the cancellation. */
  cancelledBy?: 'consultant' | 'user' | 'admin' | null;
  /** Optional free-text reason captured at cancellation. */
  cancelReason?: string | null;

  createdAt: string;
  updatedAt: string;
}

export interface MentorRecord {
  id: string;
  fullName: string;
  position: string;
  imageUrl: string;
  /** SEO-friendly URL slug (kebab-case, deduped). Optional & additive — pre-slug mentors fall back to id in routes. */
  slug?: string;
  bio: string | null;
  linkedinUrl: string | null;
  /** Contact email for consultation notifications. */
  email?: string | null;
  /**
   * Consultant WhatsApp/contact phone (digits, optional leading +). PRIVATE —
   * the recipient for the "new booking" WhatsApp notification. Never serialized
   * to the public mentor DTO; only the consultant-self / admin DTO. Set by the
   * admin (optional) and editable by the consultant (required in the portal).
   * Absent ⇒ no consultant WhatsApp is sent (email still goes out).
   */
  phone?: string | null;
  /**
   * Consultant's city — PUBLIC. Shown on the profile so a client knows where an
   * in-person session would take place before booking. The exact address +
   * Google Maps link is delivered privately per booking (see meeting address
   * fields on MentorBookingRecord). Absent ⇒ not set.
   */
  city?: string | null;
  /** Optional per-session fee in DZD. 0 or absent = free. */
  consultationFee?: number;
  createdAt: string;

  // ─── Availability (Airbnb-style scheduling) ─────────────────────────────
  // All fields below are optional & additive: mentors created before this
  // feature simply lack the keys and are treated as "no availability set"
  // (every page still renders; the public endpoint returns no dates).

  /** Recurring weekly template in the mentor's local time. */
  weeklyAvailability?: WeeklyAvailabilityDay[];
  /** Specific dates (YYYY-MM-DD) the mentor is unavailable — overrides the weekly template. */
  blockedDates?: string[];
  /** IANA timezone for the weekly template. Defaults to "Africa/Algiers". */
  availabilityTimezone?: string;

  // ─── Instant-book meeting defaults (consultant self-service) ─────────────
  /**
   * Default session format for instant-book consultations. 'OFFLINE' (in
   * person) needs no link; 'ONLINE' uses `defaultMeetingLink`. When a usable
   * default exists, a paid booking lands READY immediately; otherwise it lands
   * AWAITING_LINK until the consultant supplies one. Absent ⇒ no default set.
   */
  defaultMeetingMode?: 'ONLINE' | 'OFFLINE';
  /** Default online meeting URL (e.g. a permanent room). Null/absent ⇒ none. */
  defaultMeetingLink?: string | null;
  /**
   * Default in-person address for OFFLINE consultations (PRIVATE — delivered to
   * the client only after booking, never on the public profile). When set, an
   * OFFLINE-default booking lands READY immediately; otherwise it lands
   * AWAITING_LINK until the consultant supplies an address per booking.
   */
  defaultMeetingAddress?: string | null;
  /** Default Google Maps link for the in-person address. PRIVATE. Null/absent ⇒ none. */
  defaultMeetingMapsLink?: string | null;

  // ─── Booking policy (consultant-configurable) ────────────────────────────
  // All optional & additive: absent ⇒ engine defaults applied by the shared
  // bookable-slots validator. Existing mentors keep working unchanged.

  /**
   * Minimum lead time (hours) a client must book ahead of the session start.
   * Slots starting sooner than `now + minNoticeHours` are not bookable.
   * Expected values 24 or 48; absent ⇒ validator default (24).
   */
  minNoticeHours?: number | null;
  /**
   * Padding (minutes) reserved before AND after every booking, so back-to-back
   * sessions never touch. Subtracted by the bookable-slots validator. Absent ⇒
   * validator default (0).
   */
  bufferMinutes?: number | null;
  /** Free-text expertise tags shown on the public profile. Absent ⇒ none. */
  topics?: string[];
  /**
   * Admin-assigned category ids (`MentorCategoryRecord.id`), 0/1/many. Absent
   * ⇒ []. Purely additive — a category can be deactivated without ever being
   * removed from a mentor that already carries it (see `mentorCategories`).
   */
  categoryIds?: string[];
  /**
   * Explicit price (DZD) for a 30-minute session. Optional override — when
   * absent, price is prorated from `consultationFee` (per-hour). STORED ONLY in
   * this round; `computePrice` still uses the per-hour rate (no money change).
   */
  ratePer30?: number | null;
  /** Explicit price (DZD) for a 60-minute session. Same semantics as ratePer30. */
  ratePer60?: number | null;
  /** True if the consultant offers a free introductory session. Absent ⇒ false. */
  freeIntroEnabled?: boolean | null;

  // ─── Self-service access (PIN for trusted-device unlock) ─────────────────
  // The consultant signs in with email → OTP; the PIN is the fast re-entry on a
  // remembered device. A DB leak can't impersonate: only the scrypt hash is
  // stored. All optional & additive.

  /**
   * scrypt hash of the consultant's PIN (set on first sign-in after OTP).
   * Reuses the user password hashing util. Absent ⇒ PIN not set yet.
   */
  pinHash?: string | null;
  /** ISO timestamp the PIN was last set/changed. */
  pinSetAt?: string | null;

  // ─── Payout account (manual withdrawals) ────────────────────────────────
  // Additive & nullable. Mirrors UserRecord — consultants are payable too.

  /** Payout account on file (RIB or CCP RIP + holder name). */
  payoutAccount?: PayoutAccount | null;

  // ─── Self-signup + admin approval (consultant portal) ───────────────────
  // All additive & optional. Admin-added mentors predate these fields and are
  // grandfathered as APPROVED/ADMIN by `getMentorApprovalStatus` — they keep
  // working (and stay publicly visible) unchanged.

  /**
   * Approval state for self-signed-up consultants. Mirrors the account gate
   * (PENDING | APPROVED | REJECTED). Absent ⇒ APPROVED (legacy admin-added
   * mentors were implicitly vetted). Only APPROVED mentors are listed
   * publicly / bookable.
   */
  approvalStatus?: 'PENDING' | 'APPROVED' | 'REJECTED';
  /** Rejection reason shown to the consultant. Set only when REJECTED. */
  approvalRejectionReason?: string | null;
  /** Record origin: 'ADMIN' (dashboard-created) | 'SELF' (portal signup). Absent ⇒ 'ADMIN'. */
  source?: 'ADMIN' | 'SELF';
  /** Uploaded CV/resume URL (Cloudinary or /uploads fallback). PRIVATE — admin review only. */
  cvUrl?: string | null;
  /**
   * Whether the mentor appears on public LIST surfaces (mentors page, landing
   * carousel, `GET /api/mentors`). Absent ⇒ true for ADMIN-sourced records
   * (grandfathered), while SELF-sourced records are NEVER publicly listed —
   * even after approval — only reachable via their direct slug link. The
   * single gate is `isMentorPubliclyListed` in `@/lib/mentor-approval`.
   */
  publiclyListed?: boolean;
  /** True once the consultant's phone was verified (OTP). Absent ⇒ false. PRIVATE. */
  phoneVerified?: boolean;
  /**
   * True once the consultant's email was verified — either because the sign-in
   * OTP was delivered to it, or via the follow-up verification link. Absent ⇒
   * false. PRIVATE.
   */
  emailVerified?: boolean;
  /** Consultation domain (e.g. "Fiscalité", "Marketing"). Single headline field, distinct from `topics` tags. */
  field?: string | null;
  /**
   * Canonical profile picture URL. Absent ⇒ fall back to `imageUrl` (legacy
   * mentors-page image). Resolution happens in ONE place: `toMentorDto`.
   * Writes keep both in sync so older readers of `imageUrl` stay correct.
   */
  avatarUrl?: string | null;
  /** ISO timestamp of the last mutation. Absent on records untouched since the field shipped. */
  updatedAt?: string;

  // ─── Data-processing consent (Algerian Law 18-07) ────────────────────────
  // Captured at self-signup (public form). Both additive & optional: legacy /
  // admin-created records simply lack them.
  /** True when the consultant explicitly consented to data processing at signup. */
  privacyConsent?: boolean;
  /** ISO timestamp the consent was given (server-stamped). Null/absent ⇒ not recorded. */
  privacyAcceptedAt?: string | null;
}

/* ─────────────────── Mentor categories (admin-managed) ───────────────────
 * Fully dynamic — no category name is ever hardcoded in frontend or backend
 * code. Admins create/rename/deactivate rows via the admin dashboard; a
 * one-time seeder (`ensureMentorCategoriesSeeded`) writes the initial starter
 * set as plain data on first run. Deactivating a category never deletes it —
 * it just drops out of "assign a new category" pickers and public/dashboard
 * filters while staying on any mentor record that already carries it. */

export interface MentorCategoryRecord {
  id: string;
  label: { fr: string; en: string; ar: string };
  active: boolean;
  /** Lower sorts first. Admin-editable; ties break on label. */
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
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
  /**
   * Invoice billing profile — additive & nullable (legacy records lack them).
   * `clientType` is backfilled by the one-time `invoiceClientTypeMigrated`
   * migration: COMPANY when a companyName exists, else INDIVIDUAL.
   */
  clientType?: 'COMPANY' | 'INDIVIDUAL';
  /** Company legal / registered name (raison sociale). */
  legalName?: string | null;
  address?: string | null;
  /** Registre de Commerce. */
  rc?: string | null;
  /** Numéro d'Identification Fiscale. */
  nif?: string | null;
  /** Numéro d'Identification Statistique. */
  nis?: string | null;
  /** Article d'Imposition. */
  ai?: string | null;
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

/* ─────────────────── Contract templates ─────────────────── */

/**
 * Which space category a template applies to. Mirrors `SpaceCategory` plus an
 * `'ANY'` wildcard so a single template can cover every space the incubator
 * runs. Used to pick the applicable template(s) for a given SPACE booking.
 */
export type ContractTemplateCategory = SpaceCategory | 'ANY';

/**
 * Reusable, incubator-owned contract template. The `body` is free-text authored
 * by the incubator and may contain whitelisted `{{variables}}` (see
 * `src/server/contracts/variables.ts`) that are resolved server-side at
 * generation time against the booking + client + incubator records. Templates
 * are never coupled to a specific booking — they are filled on demand to
 * produce a downloadable PDF for any SPACE booking the incubator owns.
 *
 * Additive collection — legacy DB documents that predate this feature simply
 * lack the `contractTemplates` key and resolve to `[]` via the empty-merge.
 */
export interface ContractTemplateRecord {
  id: string;
  /** Owning incubator (IncubatorRecord.id). */
  incubatorId: string;
  /** Human label shown in the templates list and the booking picker. */
  name: string;
  /** Space category this template targets. Defaults to 'ANY' when unset. */
  spaceCategory?: ContractTemplateCategory;
  /** Free-text body with optional `{{variable}}` placeholders. */
  body: string;
  /** Drives PDF font/direction: 'ar' renders RTL with an embedded Arabic font. */
  language: 'fr' | 'en' | 'ar';
  createdAt: string;
  updatedAt: string;
}

/* ─────────────────── Invoices ─────────────────── */

/** PDF template an invoice is rendered with. */
export type InvoiceTemplate = 'CLASSIC' | 'GREEN_BAND' | 'MINIMAL';

/** Accepted payment modes printed on the invoice. Timbre applies to ESPECE only. */
export type InvoicePaymentMethod = 'ESPECE' | 'CHEQUE' | 'VIREMENT';

export interface InvoiceLine {
  designation: string;
  quantity: number;
  /** Unit price hors taxes, DZD. */
  unitPriceHt: number;
}

/**
 * A legal invoice issued by an incubator. Invoices are IMMUTABLE once issued:
 * the issuer + client legal blocks, the totals and the amount-in-words are
 * frozen at issue time so later edits to the incubator profile or the client
 * record never mutate a past invoice. The only allowed transition is
 * status → 'CANCELLED' (cancel + reissue is the legal correction path).
 *
 * All money fields are computed by src/server/invoices/engine.ts — the single
 * canonical module. UI and PDF layers read them verbatim, never recompute.
 *
 * Additive collection — legacy DB documents lack `invoices` and resolve to []
 * via the empty-merge.
 */
export interface InvoiceRecord {
  id: string;
  incubatorId: string;
  /** Display number, "NN/YYYY" (e.g. "01/2026"). Unique per incubator. */
  number: string;
  year: number;
  seq: number;
  /** ISO timestamp the invoice was issued. */
  issuedAt: string;
  /** Link to ClientRecord — null for ad-hoc (draft) recipients. */
  clientId: string | null;
  /** Recipient legal block, frozen at issue time. */
  clientSnapshot: {
    clientType: 'COMPANY' | 'INDIVIDUAL';
    name: string;
    legalName?: string | null;
    address?: string | null;
    rc?: string | null;
    nif?: string | null;
    nis?: string | null;
    ai?: string | null;
    phone?: string | null;
    email?: string | null;
  };
  /** Issuer legal header, frozen at issue time. */
  issuerSnapshot: {
    name: string;
    address?: string | null;
    rc?: string | null;
    nif?: string | null;
    nis?: string | null;
    ai?: string | null;
    logoUrl?: string | null;
    website?: string | null;
    contactEmail?: string | null;
    contactPhone?: string | null;
    /** Frozen bank details — rendered on the PDF when paymentMethod is VIREMENT. */
    bankName?: string | null;
    bankRib?: string | null;
  };
  lines: InvoiceLine[];
  /** VAT %, e.g. 19. */
  vatRate: number;
  paymentMethod: InvoicePaymentMethod;
  template: InvoiceTemplate;
  /** Computed by the engine at issue time and stored — never recomputed. */
  totals: {
    ht: number;
    tva: number;
    ttc: number;
    timbre: number;
    net: number;
  };
  /** French words for `totals.net`, frozen (e.g. "VINGT HUIT MILLE … DINARS"). */
  amountInWords: string;
  status: 'ISSUED' | 'CANCELLED';
  createdAt: string;
  updatedAt: string;
}

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
  /**
   * UUID shared by all rows from the same CSV upload batch. Doubles as the
   * import idempotency key (= the client's clientReference) so a retried upload
   * replays instead of duplicating rows. Optional/nullable for back-compat with
   * rows created before imports were keyed and with manually-added expenses.
   */
  importBatchId?: string | null;
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
  /**
   * Legacy flat booking commission (0–1) for COMMISSION-plan incubators.
   * SUPERSEDED by the central commission engine (receiverCommissionRate +
   * payerFeeRate). Kept for backward-compatible reads; no longer the
   * settlement source. Default 0.05.
   */
  commissionRate: number;

  // ─── Central commission engine (admin-configurable) ──────────────────
  /**
   * Receiver-side commission (0–1) taken FROM the account holder on platform
   * payments + online cash deposits. COMMISSION-plan incubators & all trainers
   * pay this; FLAT (Pro) incubators are exempt (0). Default 0.05. Additive &
   * nullable — missing ⇒ engine default (0.05).
   */
  receiverCommissionRate?: number;
  /**
   * Payer-side fee (0–1) added ON TOP of the base, charged to the buyer on
   * platform payments + online cash deposits. Applies on EVERY plan (FLAT
   * included). Default 0.02. Additive & nullable — missing ⇒ engine default.
   */
  payerFeeRate?: number;

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
  commissionRate: 0.05,
  receiverCommissionRate: 0.05,
  payerFeeRate: 0.02,
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

/**
 * How a withdrawal is paid out. Withdrawals are settled MANUALLY by an admin
 * (bank wire, CCP transfer, or a cheque handed over) — there is no automated
 * disbursement provider on this path.
 */
export type WithdrawalMethod = 'bank_transfer' | 'ccp' | 'cheque';

/**
 * A payable target's payout account on file (UserRecord / MentorRecord).
 * `accountNumber` is a 20-digit Algerian RIB when accountType === 'bank', or a
 * 20-digit Algérie Poste RIP when accountType === 'ccp'.
 */
export interface PayoutAccount {
  accountType: 'bank' | 'ccp';
  accountNumber: string;
  holderName: string;
}

/**
 * Manual-payout fields shared by user-wallet and mentor-ledger withdrawals.
 * Every field is optional/nullable so existing records keep working untouched.
 */
export interface PayoutFields {
  /** How the requester wants the funds. Null on legacy (free-text) requests. */
  method?: WithdrawalMethod | null;
  /**
   * The payout account frozen onto the request at creation time, so a later
   * account edit can never redirect an in-flight withdrawal. Null for cheque.
   */
  destinationAccountSnapshot?: PayoutAccount | null;
  /** Proof of the manual transfer (uploaded via /api/upload). Optional. */
  receiptUrl?: string | null;
  /** Admin who approved/rejected this request (audit). */
  processedByAdminId?: string | null;
  /** Set when the request transitions to APPROVED. */
  approvedAt?: string | null;
}

export interface WithdrawalRequestRecord extends PayoutFields {
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

/* ─────────────────────────── Mentor (consultant) ledger ───────────────────────────
 * A PARALLEL, mentorId-keyed earnings ledger. Deliberately separate from the
 * user `WalletRecord`/`TransactionRecord` system: consultants are not platform
 * users, so they have no `userId` to key a wallet against. The mechanics
 * (escrow hold → admin marks paid → refund-on-reject) mirror the user
 * withdrawal flow so the admin UX and audit trail stay consistent.
 *
 * Money model: at consultation settlement the mentor is credited
 * `net = gross − platformCommission` into `pendingBalance`; the funds are
 * released to `availableBalance` only once the session is COMPLETED (held until
 * then to cover no-shows / refunds). Only `availableBalance` is withdrawable.
 * Every amount is integer DZD. All of this is dormant until later prompts wire
 * it into the booking/settlement path. */

export type MentorWalletStatus = 'ACTIVE' | 'FROZEN';

export interface MentorWalletRecord {
  id: string;
  /** The owning mentor (MentorRecord.id). One wallet per mentor. */
  mentorId: string;
  /** Credited-but-not-yet-released earnings (held until the session COMPLETES). Integer DZD. */
  pendingBalance: number;
  /** Released, withdrawable balance. Integer DZD. */
  availableBalance: number;
  currency: 'DZD';
  status: MentorWalletStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * Ledger entry types:
 *   EARNING    — net consultation earning credited to PENDING at settlement.
 *   COMMISSION — the platform cut recorded against the same booking (audit; not added to the mentor wallet).
 *   RELEASE    — moves a prior EARNING from PENDING → AVAILABLE once COMPLETED.
 *   REVERSAL   — voids a prior entry: a not-yet-released EARNING (cancellation
 *                before completion) or a rejected withdrawal hold (refund to AVAILABLE).
 *   PAYOUT     — escrow hold deducted from AVAILABLE on withdrawal request;
 *                PENDING until the admin marks the external transfer COMPLETED
 *                (or REVERSED on rejection). Mirrors the user-wallet PAYOUT.
 */
export type MentorLedgerTxnType =
  | 'EARNING'
  | 'COMMISSION'
  | 'RELEASE'
  | 'REVERSAL'
  | 'PAYOUT';

export type MentorLedgerTxnStatus = 'PENDING' | 'COMPLETED' | 'REVERSED';

/** Which balance bucket an entry acts on. */
export type MentorLedgerBucket = 'PENDING' | 'AVAILABLE';

export interface MentorLedgerTxnRecord {
  id: string;
  mentorId: string;
  /** Originating consultation booking (MentorBookingRecord.id). Null for withdrawals. */
  bookingId: string | null;
  type: MentorLedgerTxnType;
  /** Signed integer DZD: positive = credit, negative = debit. */
  amount: number;
  bucket: MentorLedgerBucket;
  status: MentorLedgerTxnStatus;
  /** Idempotency key, unique per mentor (e.g. `mentor-earning-${bookingId}`). */
  reference: string;
  description: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  completedAt: string | null;
}

export interface MentorWithdrawalRecord extends PayoutFields {
  id: string;
  mentorId: string;
  /** Integer DZD. */
  amount: number;
  /** Free-text payment details (CCP / BaridiMob / bank account). */
  accountDetails: string;
  status: WithdrawalStatus;
  /** Ledger entry id for the escrow hold deducted from `availableBalance`. */
  holdTxnId: string;
  /** Ledger entry id for the refund issued on rejection. */
  refundTxnId?: string | null;
  adminNote?: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ─────────────────────────── Consultant (mentor) self-service access ───────────────────────────
 * Consultants are not platform users, so they cannot use the user session
 * system. These tables give them an ISOLATED email → OTP + session flow,
 * mirroring the user `OtpRecord` / `SessionRecord` mechanics (random id, only
 * the hash persisted). Keyed by mentorId; never resolves a user. The OTP itself
 * reuses the shared `d.otps` table via a `mentor:<id>` key. */

/** Consultant portal session — separate cookie/table from user sessions. */
export interface MentorSessionRecord {
  /** SHA-256 of the random session id (plaintext lives only in the cookie). */
  idHash: string;
  mentorId: string;
  expiresAt: string;
  createdAt: string;
}

/**
 * "Remember this device" token. Lets a consultant unlock with just their PIN on
 * a trusted device until expiry (60 days), skipping the email → OTP step.
 * Revocable (PIN change clears all; "forget this device" clears one). Only the
 * hash is persisted.
 */
/**
 * Email-verification token for a consultant. Deliberately a SEPARATE
 * collection from the user-scoped `emailTokens`: consultants are a distinct
 * population with no UserRecord, and sharing the table would let a consultant
 * token be consumed by the user-facing /api/auth/verify-email route (burning
 * it without verifying anyone). Mirrors `mentorSessions` / `mentorDeviceTokens`.
 */
export interface MentorEmailTokenRecord {
  /** SHA-256 of the random token (plaintext lives only in the emailed link). */
  tokenHash: string;
  mentorId: string;
  expiresAt: string;
  consumed: boolean;
  createdAt: string;
}

export interface MentorDeviceTokenRecord {
  /** SHA-256 of the random device token (plaintext lives only in the cookie). */
  tokenHash: string;
  mentorId: string;
  expiresAt: string;
  createdAt: string;
  /** Optional UA/label for the admin/consultant to recognise the device. */
  label?: string | null;
}

/**
 * Short-lived hold placed on a mentor time-slot at payment INITIATION (not
 * settlement), so two clients can't pay for the same slot concurrently. The
 * shared bookable-slots validator treats an unexpired lock as occupied.
 * Released explicitly on payment failure, or implicitly when `expiresAt`
 * passes. Keyed by the originating booking id for idempotent release.
 */
export interface MentorSlotLockRecord {
  /** Originating MentorBookingRecord.id — the idempotent release key. */
  bookingId: string;
  mentorId: string;
  /** "YYYY-MM-DD" of the held slot. */
  date: string;
  /** "HH:MM" start of the held slot (mentor local time). */
  startTime: string;
  /** Held duration in minutes. */
  durationMinutes: number;
  /** ISO expiry — after this the lock is ignored (and may be swept). */
  expiresAt: string;
  createdAt: string;
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

/**
 * COWORKING desk reservation — one named desk held for a single day, a whole
 * calendar month, or an arbitrary multi-day/multi-month range.
 *
 * Distinct from BookingRecord: desks are booked by day/month/range (no time
 * window, no wallet transaction). A desk is "taken" when an active
 * (status !== 'CANCELLED') row's day-span overlaps the queried day-span. The
 * canonical availability logic lives in `src/server/spaces/availability.ts`,
 * which collapses every record to an inclusive [start, end] day range and
 * checks plain range overlap — so any reservation blocks any other whose days
 * intersect it, regardless of the units involved.
 */
export interface DeskBookingRecord {
  id: string;
  spaceId: string;
  incubatorId: string;
  /** Matches a name in the owning space's `deskNames`. */
  deskName: string;
  /**
   * Reservation granularity. Additive & optional — legacy records lack it and
   * are treated as 'DAY'. Defaults to 'DAY'.
   */
  unit?: 'DAY' | 'MONTH' | 'RANGE';
  /**
   * The reserved period's anchor / inclusive start, by unit:
   *   - 'DAY'   → the exact "YYYY-MM-DD" reserved.
   *   - 'MONTH' → any day in the target month (canonically the 1st,
   *               "YYYY-MM-01"); only the "YYYY-MM" prefix is significant.
   *   - 'RANGE' → the inclusive START day "YYYY-MM-DD"; `endDate` is the
   *               inclusive end. Use this for spans longer than one month.
   */
  date: string;
  /**
   * Inclusive END day "YYYY-MM-DD" for unit 'RANGE'. Ignored for DAY/MONTH.
   * Additive & optional — legacy/day/month records omit it.
   */
  endDate?: string;
  /** Platform user who booked. Null for offline / manual incubator entries. */
  userId: string | null;
  /** For offline bookings: client's name (not necessarily a platform user). */
  clientName: string | null;
  clientPhone: string | null;
  status: 'CONFIRMED' | 'CANCELLED';
  source: 'online' | 'offline';
  /**
   * Parent BookingRecord this desk hold belongs to. Set when the hold was
   * written alongside a SPACE booking (manual or online) so cancellation can
   * release every day of the reservation in one pass. Null for standalone
   * incubator desk blocks (desk-calendar) and legacy records.
   * Additive & nullable — defaults to null.
   */
  bookingId: string | null;
  /**
   * ISO timestamp of when the "rental ending soon" reminder was sent for this
   * hold's parent booking. Null until sent — prevents duplicate reminders.
   * Additive & nullable — defaults to null.
   */
  expiryReminderSentAt: string | null;
  createdAt: string;
}

/**
 * DOMICILIATION address-slot request — no calendar booking. The visitor
 * submits a form; the incubator follows up offline and moves the request
 * through the lifecycle. A slot counts as consumed when status === 'ACTIVE',
 * compared against the space's `domiciliationSlots`.
 */
export interface DomiciliationRequestRecord {
  id: string;
  spaceId: string;
  incubatorId: string;
  /**
   * Platform user who submitted the request. Null for guest (logged-out)
   * submissions. Additive & nullable — legacy records lack it.
   */
  userId: string | null;
  fullName: string;
  companyName: string | null;
  phone: string;
  email: string;
  message: string | null;
  status: 'PENDING' | 'CONTACTED' | 'ACTIVE' | 'REJECTED';
  createdAt: string;
}

/**
 * One recipient of one manual announcement campaign. Written only by the
 * scripts under `scripts/campaigns/` — no app code creates these. The
 * (campaignId, mentorId) pair is the idempotency key: a re-run skips anyone
 * already present, so a partially-completed batch can be resumed safely.
 */
export interface CampaignSendRecord {
  /** Stable campaign slug, e.g. "2026-08-consultant-update". */
  campaignId: string;
  /** MentorRecord.id of the recipient. */
  mentorId: string;
  /** Address the email actually went to (snapshot — the mentor record may change later). */
  email: string;
  /** ISO timestamp of the successful send. */
  sentAt: string;
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
  /** Short-lived guest selection carriers for the public-space booking flow. */
  bookingIntents: BookingIntentRecord[];
  /** Incubator-created direct payment links (no payer account required). */
  paymentLinks: PaymentLinkRecord[];
  contactSubmissions: ContactSubmissionRecord[];
  startupListings: StartupListingRecord[];
  mentors: MentorRecord[];
  mentorBookings: MentorBookingRecord[];
  /** Admin-managed category taxonomy assignable to mentors. */
  mentorCategories: MentorCategoryRecord[];
  incubators: IncubatorRecord[];
  promoCodes: PromoCodeRecord[];
  /** DB-persisted space listings created by incubators. */
  spaces: SpaceRecord[];
  /** DB-persisted program listings created by incubators. */
  programs: ProgramRecord[];
  /** DB-persisted event listings created by incubators. */
  events: EventRecord[];
  /** COWORKING per-desk, per-day reservations (online + manual). */
  deskBookings: DeskBookingRecord[];
  /** DOMICILIATION address-slot requests (handled offline by the incubator). */
  domiciliationRequests: DomiciliationRequestRecord[];
  /** CRM — client records per incubator. */
  clients: ClientRecord[];
  /** Per-incubator service catalog (used in manual income / CSV imports). */
  services: ServiceRecord[];
  /** Reusable, incubator-owned contract templates (filled per booking → PDF). */
  contractTemplates: ContractTemplateRecord[];
  /** Legal invoices issued by incubators — immutable snapshots (see InvoiceRecord). */
  invoices: InvoiceRecord[];
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
  /** Parallel, mentorId-keyed consultant earnings wallets (pending/available). */
  mentorWallets: MentorWalletRecord[];
  /** Append-only ledger backing the mentor wallets. */
  mentorLedgerTxns: MentorLedgerTxnRecord[];
  /** Withdrawal requests submitted by consultants against their mentor wallet. */
  mentorWithdrawals: MentorWithdrawalRecord[];
  /** Active consultant portal sessions (mentorId-keyed). */
  mentorSessions: MentorSessionRecord[];
  /** "Remember this device" tokens for trusted-device PIN unlock. */
  mentorDeviceTokens: MentorDeviceTokenRecord[];
  /** Consultant email-verification tokens (separate from user `emailTokens`). */
  mentorEmailTokens?: MentorEmailTokenRecord[];
  /** Short-lived slot holds taken at payment initiation. */
  mentorSlotLocks: MentorSlotLockRecord[];

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

  // ─── Partner Perks ────────────────────────────────────────────────────
  /** Admin-created partner perks claimable by Builder+ subscribers. */
  perks: PerkRecord[];
  /** Partner-issued promo codes backing CODE_POOL perks. */
  perkPoolEntries: PromoCodePoolEntryRecord[];
  /** Metwork-issued vouchers backing VOUCHER perks (live-validated). */
  perkVouchers: VoucherRecord[];

  // ─── Registration System ──────────────────────────────────────────────
  /** Custom form field definitions per program or event. */
  registrationFormFields: RegistrationFormFieldRecord[];
  /** Guest + authenticated registrations for programs and events. */
  registrations: RegistrationRecord[];

  // ─── One-off email campaigns ──────────────────────────────────────────
  /**
   * Append-only send log for manual announcement campaigns. Read before each
   * send and written after each success so a re-run never double-emails
   * anyone. Optional — legacy blobs predate it; readers must default to [].
   */
  campaignSends?: CampaignSendRecord[];

  /**
   * One-shot flags and platform-wide config.
   */
  meta: {
    mentorsSeeded?: boolean;
    /** Set once the starter mentor-category rows have been written. */
    mentorCategoriesSeeded?: boolean;
    promoCodesSeeded?: boolean;
    demoMentorsRemoved?: boolean;
    /** Set once legacy TRAINER-role users are migrated to the BUSINESS role. */
    businessRoleMigrated?: boolean;
    /**
     * Set once BUSINESS-role users are merged into the INCUBATOR role and their
     * provider records have `businessType` backfilled. Carries the migration
     * report so the counts survive past the log line that printed them.
     */
    businessMergedIntoIncubator?: {
      at: string;
      /** Users whose role flipped BUSINESS → INCUBATOR. */
      migratedCount: number;
      /** Breakdown of the legacy `businessSubType` the mapping was derived from. */
      byLegacySubType: Record<string, number>;
      /** Provider records that received a `businessType` value. */
      providersUpdated: number;
      /**
       * Migrated users with NO linked IncubatorRecord (managerId lookup missed).
       * Logged + skipped, never fabricated — these need manual admin follow-up.
       */
      orphanedUserIds: string[];
    };
    /** Set once legacy clients have clientType backfilled (COMPANY when companyName set). */
    invoiceClientTypeMigrated?: boolean;
    platformConfig?: PlatformConfig;
    /** ISO timestamp — set once the one-time per-space → per-incubator partner migration runs. */
    partnerPerIncubatorMigratedAt?: string;
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
  bookingIntents: [],
  paymentLinks: [],
  contactSubmissions: [],
  startupListings: [],
  mentors: [],
  mentorCategories: [],
  mentorBookings: [],
  incubators: [],
  promoCodes: [],
  spaces: [],
  programs: [],
  events: [],
  deskBookings: [],
  domiciliationRequests: [],
  clients: [],
  services: [],
  contractTemplates: [],
  invoices: [],
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
  mentorWallets: [],
  mentorLedgerTxns: [],
  mentorWithdrawals: [],
  mentorSessions: [],
  mentorDeviceTokens: [],
  mentorEmailTokens: [],
  mentorSlotLocks: [],
  networkVisits: [],
  partnerMemberships: [],
  partnerPromoCodes: [],
  partnerPromoCodeBatches: [],
  userPartnerAffiliations: [],
  networkCheckInCodes: [],
  networkCheckInAuditLogs: [],
  perks: [],
  perkPoolEntries: [],
  perkVouchers: [],
  registrationFormFields: [],
  registrations: [],
  campaignSends: [],
  meta: {},
};

// ---------------------------------------------------------------------------
// Local JSON file backend (dev / CI — activated by USE_LOCAL_DB=true)
// ---------------------------------------------------------------------------

function isLocalMode(): boolean {
  return process.env.USE_LOCAL_DB === 'true';
}

function localDbPath(): string {
  // Keep the file outside src/ so hot-reload doesn't re-trigger on writes.
  return process.env.LOCAL_DB_PATH ?? '.local-db.json';
}

function localLoad(): DbShape {
  // Node is guaranteed in this path (API routes, seed scripts).
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const fs = require('fs') as typeof import('fs');
  const p = localDbPath();
  if (!fs.existsSync(p)) return structuredClone(empty);
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const parsed: Partial<DbShape> = JSON.parse(raw);
    return { ...empty, ...parsed };
  } catch {
    return structuredClone(empty);
  }
}

function localPersist(data: DbShape): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const fs = require('fs') as typeof import('fs');
  fs.writeFileSync(localDbPath(), JSON.stringify(data, null, 2), 'utf8');
}

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
/**
 * Idempotent one-time migrations applied to `cache` after every cold load,
 * for BOTH the local-file and Supabase backends. Each is guarded by a meta
 * flag and only persists when it actually changes something.
 */
async function applyOneTimeMigrations(): Promise<void> {
  let changed = false;

  // Purge the 8 hardcoded demo mentor records and any bookings that reference
  // them. Runs once, then the flag is set.
  if (!cache!.meta?.demoMentorsRemoved) {
    const DEMO_IDS = new Set([
      'mn_amina', 'mn_yacine', 'mn_nora', 'mn_karim',
      'mn_sara',  'mn_riad',  'mn_imane', 'mn_walid',
    ]);
    cache!.mentors        = (cache!.mentors        ?? []).filter((m) => !DEMO_IDS.has(m.id));
    cache!.mentorBookings = (cache!.mentorBookings ?? []).filter((b) => !DEMO_IDS.has(b.mentorId));
    cache!.meta = { ...(cache!.meta ?? {}), demoMentorsRemoved: true };
    changed = true;
  }

  /**
   * Fold a trainer/business-origin user + its provider record into the final
   * INCUBATOR end-state: role, `businessType`, and `providerType` all land
   * consistently regardless of which legacy role the row started from.
   * Shared by both migration blocks below so a TRAINER-origin row and a
   * direct-signup BUSINESS-origin row converge on identical output.
   */
  function foldIntoIncubator(u: UserRecord): { businessType: boolean } {
    u.role = 'INCUBATOR';
    const provider = (cache!.incubators ?? []).find((i) => i.managerId === u.id);
    if (!provider) return { businessType: false };
    let businessTypeSet = false;
    if (provider.businessType == null) {
      provider.businessType = 'TRAINING_CENTER';
      businessTypeSet = true;
    }
    // 'TRAINER' / 'BUSINESS' literals remain in the union so pre-merge blobs still parse.
    if (provider.providerType === 'BUSINESS' || provider.providerType === 'TRAINER') {
      provider.providerType = 'INCUBATOR';
    }
    return { businessType: businessTypeSet };
  }

  // The former TRAINER role predates the BUSINESS role, which was itself
  // later retired and merged into INCUBATOR (see the block right below).
  // Since BUSINESS no longer exists as a valid role at all, a TRAINER-origin
  // row now migrates directly to its final INCUBATOR end-state in one step
  // instead of via the old two-hop TRAINER→BUSINESS→INCUBATOR path. Default
  // its sub-type to TRAINER for the admin approvals UI, which still displays
  // the legacy field. Idempotent via flag.
  if (!cache!.meta?.businessRoleMigrated) {
    for (const u of cache!.users ?? []) {
      if ((u.role as string) === 'TRAINER') {
        if (u.businessSubType == null) u.businessSubType = 'TRAINER';
        foldIntoIncubator(u);
      }
    }
    cache!.meta = { ...(cache!.meta ?? {}), businessRoleMigrated: true };
    changed = true;
  }

  // Business→Incubator merge. The standalone BUSINESS role is retired: every
  // BUSINESS user becomes an INCUBATOR (they already owned an IncubatorRecord
  // and were governed by the same approval gate), and the organisation's kind
  // moves to the new informational `IncubatorRecord.businessType`.
  //
  // Capability parity is automatic — no route or guard keys off businessType,
  // and INCUBATOR is a strict superset of what BUSINESS could do, so migrated
  // accounts gain access (spaces, invoicing, …) and lose nothing.
  //
  // Nothing is destroyed: the legacy `user.businessSubType` and the provider's
  // `providerType` are left exactly as they were, so the mapping stays auditable
  // and a rollback can reconstruct the original role. Idempotent via the flag.
  if (!cache!.meta?.businessMergedIntoIncubator) {
    const byLegacySubType: Record<string, number> = {};
    const orphanedUserIds: string[] = [];
    let migratedCount = 0;
    let providersUpdated = 0;

    for (const u of cache!.users ?? []) {
      if ((u.role as string) !== 'BUSINESS') continue;

      // Every legacy sub-type collapses to TRAINING_CENTER: TRAINER and
      // TRAINING_CENTER are literally training providers, and COMPANY (the
      // catch-all) is mapped there too rather than guessing INCUBATOR or
      // COWORKING_SPACE — a wrong label is cosmetic and owner-correctable,
      // whereas dropping the record's kind entirely is not recoverable.
      const legacy = u.businessSubType ?? 'UNSET';
      byLegacySubType[legacy] = (byLegacySubType[legacy] ?? 0) + 1;
      migratedCount += 1;

      const hadProvider = (cache!.incubators ?? []).some((i) => i.managerId === u.id);
      if (!hadProvider) {
        // Log + skip. Deliberately NOT fabricating an IncubatorRecord: an
        // invented org record would be indistinguishable from a real one and
        // would land unapproved in public listings. Role still flips so the
        // account isn't left in a role that no longer resolves anywhere.
        u.role = 'INCUBATOR';
        orphanedUserIds.push(u.id);
        continue;
      }
      const { businessType } = foldIntoIncubator(u);
      if (businessType) providersUpdated += 1;
    }

    const report = {
      at: new Date().toISOString(),
      migratedCount,
      byLegacySubType,
      providersUpdated,
      orphanedUserIds,
    };
    if (migratedCount > 0 || orphanedUserIds.length > 0) {
      console.info('[migration] business→incubator merge', JSON.stringify(report));
      if (orphanedUserIds.length > 0) {
        console.warn(
          `[migration] business→incubator: ${orphanedUserIds.length} migrated user(s) have no ` +
            `IncubatorRecord and were skipped (manual follow-up): ${orphanedUserIds.join(', ')}`,
        );
      }
    }
    cache!.meta = { ...(cache!.meta ?? {}), businessMergedIntoIncubator: report };
    changed = true;
  }

  // Backfill ClientRecord.clientType for records that predate invoicing:
  // COMPANY when a companyName is present, INDIVIDUAL otherwise. Records
  // created after this feature set clientType explicitly. Idempotent via flag.
  if (!cache!.meta?.invoiceClientTypeMigrated) {
    for (const c of cache!.clients ?? []) {
      if (c.clientType == null) {
        c.clientType = c.companyName ? 'COMPANY' : 'INDIVIDUAL';
      }
    }
    cache!.meta = { ...(cache!.meta ?? {}), invoiceClientTypeMigrated: true };
    changed = true;
  }

  if (changed) await persist(cache!);
}

async function load(): Promise<DbShape> {
  if (cache && Date.now() - cacheAt < CACHE_TTL_MS) return cache;
  // Cache is absent or stale — discard and re-fetch.
  cache = null;

  if (isLocalMode()) {
    cache = localLoad();
    await applyOneTimeMigrations();
    cacheAt = Date.now();
    return cache;
  }

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

  await applyOneTimeMigrations();

  cacheAt = Date.now();
  return cache!;
}

/**
 * Persist the current in-memory state to Supabase via UPSERT.
 * Always updates row id = 1.
 */
async function persist(db: DbShape): Promise<void> {
  if (isLocalMode()) {
    localPersist(db);
    return;
  }
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

/**
 * TEST-ONLY: reset the in-process cache and write queue so the next read
 * fetches fresh state from Supabase. Used by the Vitest setup to prevent
 * test-N from seeing test-N-1's data. Do NOT call this from production
 * code — there's no scenario where a serverless function should discard
 * its cache mid-request.
 *
 * The leading double-underscore is a convention signalling "internal" —
 * lint can grep for it to forbid use outside __tests__/.
 */
export function __resetCacheForTests(): void {
  cache = null;
  cacheAt = 0;
  writeQueue = Promise.resolve();
}
