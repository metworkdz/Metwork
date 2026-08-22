/**
 * Mentor (consultant) earnings ledger — a parallel, mentorId-keyed wallet.
 *
 * Consultants are not platform users, so they cannot share the userId-keyed
 * `WalletRecord` system. This module owns an independent ledger whose mechanics
 * deliberately mirror the user wallet + withdrawal flow so the admin UX and
 * audit trail stay consistent:
 *
 *   ANY earning           → applyMentorEarningToDraft (THE canonical credit —
 *                           consultations AND programs both go through it)
 *   consultation settle   → creditPendingEarning     (async wrapper, → PENDING)
 *   consultation complete → releaseToAvailable       (PENDING → AVAILABLE)
 *   consultation cancel   → voidPendingEarning       (void an unreleased earning)
 *   program settle        → applyMentorEarningToDraft (bucket AVAILABLE, no hold)
 *   withdraw              → requestMentorWithdrawal  (escrow hold from AVAILABLE)
 *   admin acts            → resolveMentorWithdrawal  (mark paid / refund)
 *
 * Guarantees:
 *  - Every mutation runs inside a single `db.update` critical section.
 *    `applyMentorEarningToDraft` is deliberately synchronous-on-draft so the
 *    program rail can run it inside card-payment.ts's own settlement
 *    transaction (wallet credit + booking status commit together) rather than
 *    opening a second, nested one; `creditPendingEarning` wraps it for callers
 *    that own no transaction.
 *  - Every amount is integer DZD; `availableBalance` can never go negative.
 *  - Every state transition is idempotent via a per-mentor `reference` key, so
 *    settlement/cancellation replays (webhook + return, double click) move money
 *    at most once.
 */
import { randomUUID } from 'node:crypto';
import {
  db,
  type MentorLedgerTxnRecord,
  type MentorWalletRecord,
  type MentorWithdrawalRecord,
  type PayoutAccount,
  type WithdrawalMethod,
} from '@/server/db/store';
import {
  computeMentorPromoSplit,
  ratesFromFrozen,
  type MentorEarningKind,
  type MentorEarningSplit,
} from '@/server/payments/mentor-commission';

/** Smallest withdrawal a consultant may request (mirrors the user wallet floor). */
export const MIN_MENTOR_WITHDRAWAL = 500;

/* ───────────────────────────── Internal helpers ───────────────────────────── */

type StoreDraft = Parameters<Parameters<typeof db.update>[0]>[0];

function newMentorWallet(mentorId: string): MentorWalletRecord {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    mentorId,
    pendingBalance: 0,
    availableBalance: 0,
    currency: 'DZD',
    status: 'ACTIVE',
    createdAt: now,
    updatedAt: now,
  };
}

/** Ensure the per-mentor wallet exists within an open mutation. */
function ensureMentorWallet(d: StoreDraft, mentorId: string): MentorWalletRecord {
  if (!Array.isArray(d.mentorWallets)) d.mentorWallets = [];
  let wallet = d.mentorWallets.find((w) => w.mentorId === mentorId);
  if (!wallet) {
    wallet = newMentorWallet(mentorId);
    d.mentorWallets.push(wallet);
  }
  return wallet;
}

/** Find a prior ledger entry for this mentor by its idempotency reference. */
function findByReference(
  d: StoreDraft,
  mentorId: string,
  reference: string,
): MentorLedgerTxnRecord | undefined {
  return (d.mentorLedgerTxns ?? []).find(
    (t) => t.mentorId === mentorId && t.reference === reference,
  );
}

function pushTxn(d: StoreDraft, txn: MentorLedgerTxnRecord): MentorLedgerTxnRecord {
  if (!Array.isArray(d.mentorLedgerTxns)) d.mentorLedgerTxns = [];
  d.mentorLedgerTxns.push(txn);
  return txn;
}

/* ───────────────────────────── Reads ───────────────────────────── */

export async function getMentorWallet(mentorId: string): Promise<MentorWalletRecord | null> {
  const data = await db.read();
  return (data.mentorWallets ?? []).find((w) => w.mentorId === mentorId) ?? null;
}

export async function getOrCreateMentorWallet(mentorId: string): Promise<MentorWalletRecord> {
  return db.update<MentorWalletRecord>((d) => ensureMentorWallet(d, mentorId));
}

export interface MentorLedgerView {
  wallet: MentorWalletRecord;
  txns: MentorLedgerTxnRecord[];
}

/** Wallet + full ledger for the consultant earnings dashboard, newest first. */
export async function getMentorLedgerView(mentorId: string): Promise<MentorLedgerView> {
  const wallet = await getOrCreateMentorWallet(mentorId);
  const data = await db.read();
  const txns = (data.mentorLedgerTxns ?? [])
    .filter((t) => t.mentorId === mentorId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { wallet, txns };
}

/* ───────────────────────────── Earnings ───────────────────────────── */

export interface CreditPendingEarningResult {
  replayed: boolean;
  wallet: MentorWalletRecord;
  split: MentorEarningSplit;
}

/** Which balance an earning lands in. See `applyMentorEarningToDraft`. */
export type MentorEarningBucket = 'PENDING' | 'AVAILABLE';

export interface ApplyMentorEarningInput {
  mentorId: string;
  bookingId: string;
  /** What the payer actually paid (after tier + promo). Integer DZD. */
  grossAmount: number;
  /** Absolute base price B (before discounts). Defaults to grossAmount. */
  consultantShareBase?: number | null;
  /** DZD the platform absorbed from the membership tier (audit). */
  tierDiscountAmount?: number | null;
  /** DZD the platform absorbed from the promo code (audit). */
  promoDiscountAmount?: number | null;
  /** Promo code applied, for the subsidy audit trail. */
  appliedPromoCode?: string | null;
  /** What this earning is FOR — selects the commission rule. Omitted ⇒ CONSULTATION. */
  kind?: MentorEarningKind | null;
  /**
   * Where the credit lands. Omitted ⇒ PENDING (consultations: held until the
   * session COMPLETES, released by `releaseToAvailable`). PROGRAM settlements
   * pass AVAILABLE — program earnings are withdrawable immediately, mirroring
   * how incubator-owned programs pay out at settlement with no hold either.
   */
  bucket?: MentorEarningBucket | null;
  /**
   * Platform rate snapshotted onto the booking EARLIER (at creation). When
   * present it wins over the live admin rule, so an admin editing the rate
   * afterwards cannot re-split an existing booking. Absent ⇒ resolve the rule
   * live (consultations, which are pay-first so creation ≈ settlement).
   */
  frozenPlatformRate?: number | null;
}

/**
 * THE canonical mentor-earning credit. Everything that pays a consultant —
 * 1:1 consultations and consultant-owned programs alike — goes through this
 * one function, so the split math, the idempotency key, the ledger shape and
 * the audit trail can never diverge between the two rails.
 *
 * SYNCHRONOUS on an already-open draft: `db.update` calls cannot nest, and the
 * program rail runs inside `card-payment.ts`'s own settlement transaction (so
 * the wallet credit and the booking's CONFIRMED transition commit together, or
 * not at all). `creditPendingEarning` below is the async wrapper for callers
 * that own no transaction.
 *
 * Owner-locked split (2026-06-18): the consultant is paid on the FULL
 * undiscounted base price `consultantShareBase`; the platform absorbs every
 * discount. `platformShare = collected − consultantShare` and MAY be negative
 * (platform pays out of pocket). When `consultantShareBase` is omitted it
 * defaults to `grossAmount`. A zero base is a no-op credit. The resolved rates
 * and discount components are frozen into the ledger rows here, so the admin
 * revenue P&L never has to recompute them.
 *
 * Idempotent per booking via the `mentor-earning-${bookingId}` reference: a
 * replay returns the ORIGINAL frozen split (read back off the prior row) and
 * moves no money.
 */
export function applyMentorEarningToDraft(
  d: StoreDraft,
  input: ApplyMentorEarningInput,
): CreditPendingEarningResult {
  const { mentorId, bookingId, grossAmount } = input;
  const basePrice =
    input.consultantShareBase != null && input.consultantShareBase > 0
      ? input.consultantShareBase
      : grossAmount;
  const kind: MentorEarningKind = input.kind ?? 'CONSULTATION';
  const bucket: MentorEarningBucket = input.bucket ?? 'PENDING';
  const tierDiscountAmount = Math.max(0, Math.round(input.tierDiscountAmount ?? 0));
  const promoDiscountAmount = Math.max(0, Math.round(input.promoDiscountAmount ?? 0));
  const earningRef = `mentor-earning-${bookingId}`;
  const isProgram = kind === 'PROGRAM';

  const wallet = ensureMentorWallet(d, mentorId);

  // ── Idempotency ────────────────────────────────────────────────────────
  // A prior earning for this booking replays with the ORIGINAL split, read
  // back off the frozen ledger metadata rather than recomputed — so even if
  // the admin rate changed in between, a replay reports (and moves) exactly
  // what the first settlement did.
  const prior = findByReference(d, mentorId, earningRef);
  if (prior) {
    const meta = prior.metadata as {
      gross?: number; platformShare?: number; platformRate?: number; mentorRate?: number;
    };
    return {
      replayed: true,
      wallet,
      split: {
        gross: meta.gross ?? prior.amount,
        platformCommission: meta.platformShare ?? 0,
        mentorNet: prior.amount,
        platformRate: meta.platformRate ?? 0,
        mentorRate: meta.mentorRate ?? 1,
      },
    };
  }

  // Rate is selected by what the earning is FOR (consultation vs program) and
  // resolved inside this same atomic update, so the split and the rules read
  // the same document version. A rate frozen at booking creation wins.
  const promo = computeMentorPromoSplit(
    { basePrice, collectedAmount: grossAmount },
    d.commissionRules,
    { kind },
    ratesFromFrozen(input.frozenPlatformRate),
  );
  // Shape kept MentorEarningSplit-compatible for existing consumers: gross =
  // what was collected, platformCommission = the (signed) platform share.
  const split: MentorEarningSplit = {
    gross: promo.collectedAmount,
    platformCommission: promo.platformShare,
    mentorNet: promo.consultantShare,
    platformRate: promo.platformRate,
    mentorRate: promo.mentorRate,
  };

  const now = new Date().toISOString();

  if (split.mentorNet > 0) {
    if (bucket === 'AVAILABLE') wallet.availableBalance += split.mentorNet;
    else wallet.pendingBalance += split.mentorNet;
    wallet.updatedAt = now;
  }

  pushTxn(d, {
    id: randomUUID(),
    mentorId,
    bookingId,
    type: 'EARNING',
    amount: split.mentorNet,
    bucket,
    status: 'COMPLETED',
    reference: earningRef,
    description: isProgram
      ? 'Program earning'
      : 'Consultation earning (held until completed)',
    metadata: {
      gross: split.gross,
      basePrice: promo.basePrice,
      consultantShare: promo.consultantShare,
      platformShare: promo.platformShare,
      platformCommission: split.platformCommission,
      platformRate: split.platformRate,
      mentorRate: split.mentorRate,
    },
    createdAt: now,
    completedAt: now,
  });

  // Audit-only: the platform's net + the discounts it absorbed. Recorded
  // against the booking, never added to the mentor wallet. Always written when
  // there is a real base so the admin P&L can see subsidies (platformShare can
  // be ≤ 0 under the subsidize model).
  if (promo.basePrice > 0) {
    const totalDiscountAbsorbed = tierDiscountAmount + promoDiscountAmount;
    pushTxn(d, {
      id: randomUUID(),
      mentorId,
      bookingId,
      type: 'COMMISSION',
      amount: -promo.platformShare,
      bucket,
      status: 'COMPLETED',
      reference: `mentor-commission-${bookingId}`,
      description:
        promo.platformShare >= 0
          ? `Platform share on ${isProgram ? 'program' : 'consultation'}`
          : `Platform subsidy on ${isProgram ? 'program' : 'consultation'} (discount absorbed)`,
      metadata: {
        gross: promo.collectedAmount,
        basePrice: promo.basePrice,
        consultantShare: promo.consultantShare,
        platformShare: promo.platformShare,
        tierDiscountAmount,
        promoDiscountAmount,
        totalDiscountAbsorbed,
        platformRate: promo.platformRate,
        mentorRate: promo.mentorRate,
        appliedPromoCode: input.appliedPromoCode ?? null,
      },
      createdAt: now,
      completedAt: now,
    });
  }

  return { replayed: false, wallet, split };
}

/**
 * Async wrapper around {@link applyMentorEarningToDraft} for callers that do
 * NOT already hold an open `db.update` — the consultation settlement paths.
 * Opens the transaction and delegates; all behaviour lives in the canonical
 * function above.
 */
export async function creditPendingEarning(
  input: ApplyMentorEarningInput,
): Promise<CreditPendingEarningResult> {
  return db.update<CreditPendingEarningResult>((d) => applyMentorEarningToDraft(d, input));
}

export type ReleaseEarningResult =
  | { ok: true; replayed: boolean; wallet: MentorWalletRecord; released: number }
  | { ok: false; reason: 'NO_EARNING' | 'EARNING_REVERSED' };

/**
 * Release a booking's held earning from PENDING → AVAILABLE once the session is
 * COMPLETED. Idempotent per booking. Refuses if no earning was ever credited or
 * if it was reversed (cancelled) before completion.
 */
export async function releaseToAvailable(input: {
  mentorId: string;
  bookingId: string;
}): Promise<ReleaseEarningResult> {
  const { mentorId, bookingId } = input;
  const releaseRef = `mentor-release-${bookingId}`;
  const earningRef = `mentor-earning-${bookingId}`;

  return db.update<ReleaseEarningResult>((d) => {
    const wallet = ensureMentorWallet(d, mentorId);

    // Already released → replay.
    const prior = findByReference(d, mentorId, releaseRef);
    if (prior) return { ok: true, replayed: true, wallet, released: prior.amount };

    const earning = findByReference(d, mentorId, earningRef);
    if (!earning || earning.type !== 'EARNING') return { ok: false, reason: 'NO_EARNING' };
    if (earning.status === 'REVERSED') return { ok: false, reason: 'EARNING_REVERSED' };

    const amount = earning.amount;
    const now = new Date().toISOString();
    if (amount > 0) {
      wallet.pendingBalance = Math.max(0, wallet.pendingBalance - amount);
      wallet.availableBalance += amount;
      wallet.updatedAt = now;
    }

    pushTxn(d, {
      id: randomUUID(),
      mentorId,
      bookingId,
      type: 'RELEASE',
      amount,
      bucket: 'AVAILABLE',
      status: 'COMPLETED',
      reference: releaseRef,
      description: 'Consultation earning released after completion',
      metadata: { earningTxnId: earning.id },
      createdAt: now,
      completedAt: now,
    });

    return { ok: true, replayed: false, wallet, released: amount };
  });
}

export type VoidEarningResult =
  | { ok: true; replayed: boolean; wallet: MentorWalletRecord; voided: number }
  | { ok: false; reason: 'NO_EARNING' | 'ALREADY_RELEASED' };

/**
 * Void a not-yet-released earning (consultation cancelled before completion).
 * Removes the credit from PENDING and marks the earning REVERSED. Idempotent.
 * Refuses if the earning was already released to AVAILABLE.
 */
export async function voidPendingEarning(input: {
  mentorId: string;
  bookingId: string;
}): Promise<VoidEarningResult> {
  const { mentorId, bookingId } = input;
  const reversalRef = `mentor-reversal-${bookingId}`;
  const releaseRef = `mentor-release-${bookingId}`;
  const earningRef = `mentor-earning-${bookingId}`;

  return db.update<VoidEarningResult>((d) => {
    const wallet = ensureMentorWallet(d, mentorId);

    const prior = findByReference(d, mentorId, reversalRef);
    if (prior) return { ok: true, replayed: true, wallet, voided: -prior.amount };

    if (findByReference(d, mentorId, releaseRef)) {
      return { ok: false, reason: 'ALREADY_RELEASED' };
    }

    const earning = findByReference(d, mentorId, earningRef);
    if (!earning || earning.type !== 'EARNING') return { ok: false, reason: 'NO_EARNING' };

    const amount = earning.amount;
    const now = new Date().toISOString();
    if (amount > 0) {
      wallet.pendingBalance = Math.max(0, wallet.pendingBalance - amount);
      wallet.updatedAt = now;
    }
    earning.status = 'REVERSED';

    pushTxn(d, {
      id: randomUUID(),
      mentorId,
      bookingId,
      type: 'REVERSAL',
      amount: -amount,
      bucket: 'PENDING',
      status: 'COMPLETED',
      reference: reversalRef,
      description: 'Consultation earning voided (cancelled before completion)',
      metadata: { earningTxnId: earning.id },
      createdAt: now,
      completedAt: now,
    });

    return { ok: true, replayed: false, wallet, voided: amount };
  });
}

/* ───────────────────────────── Withdrawals ───────────────────────────── */

export type RequestWithdrawalResult =
  | { ok: true; request: MentorWithdrawalRecord; wallet: MentorWalletRecord }
  | { ok: false; reason: 'WALLET_FROZEN' }
  | { ok: false; reason: 'INSUFFICIENT_FUNDS'; available: number; required: number }
  | { ok: false; reason: 'BELOW_MINIMUM'; minimum: number };

/**
 * Request a withdrawal against AVAILABLE balance. The amount is held in escrow
 * immediately (mirrors the user wallet): it leaves `availableBalance` and a
 * PENDING `PAYOUT` ledger entry is written, alongside the withdrawal request.
 */
export async function requestMentorWithdrawal(input: {
  mentorId: string;
  amount: number;
  accountDetails: string;
  /** Structured manual-payout method (bank_transfer / ccp / cheque). Null on legacy free-text requests. */
  method?: WithdrawalMethod | null;
  /** Payout account frozen onto the request at creation (null for cheque). */
  destinationAccountSnapshot?: PayoutAccount | null;
}): Promise<RequestWithdrawalResult> {
  const { mentorId, accountDetails } = input;
  const amount = Math.round(input.amount);

  return db.update<RequestWithdrawalResult>((d) => {
    if (!Array.isArray(d.mentorWithdrawals)) d.mentorWithdrawals = [];
    const wallet = ensureMentorWallet(d, mentorId);

    if (amount < MIN_MENTOR_WITHDRAWAL) {
      return { ok: false, reason: 'BELOW_MINIMUM', minimum: MIN_MENTOR_WITHDRAWAL };
    }
    if (wallet.status === 'FROZEN') return { ok: false, reason: 'WALLET_FROZEN' };
    if (wallet.availableBalance < amount) {
      return { ok: false, reason: 'INSUFFICIENT_FUNDS', available: wallet.availableBalance, required: amount };
    }

    const now = new Date().toISOString();
    wallet.availableBalance -= amount;
    wallet.updatedAt = now;

    const hold = pushTxn(d, {
      id: randomUUID(),
      mentorId,
      bookingId: null,
      type: 'PAYOUT',
      amount: -amount,
      bucket: 'AVAILABLE',
      status: 'PENDING',
      reference: `mentor-withdrawal-hold-${randomUUID().slice(0, 8)}`,
      description: `Withdrawal request — ${amount.toLocaleString()} DZD`,
      metadata: { accountDetails },
      createdAt: now,
      completedAt: null,
    });

    const request: MentorWithdrawalRecord = {
      id: randomUUID(),
      mentorId,
      amount,
      accountDetails,
      status: 'PENDING',
      holdTxnId: hold.id,
      method: input.method ?? null,
      destinationAccountSnapshot: input.destinationAccountSnapshot ?? null,
      createdAt: now,
      updatedAt: now,
    };
    d.mentorWithdrawals.push(request);

    return { ok: true, request, wallet };
  });
}

export type ResolveWithdrawalResult =
  | { ok: true; request: MentorWithdrawalRecord }
  | { ok: false; reason: 'NOT_FOUND' | 'ALREADY_RESOLVED' | 'WALLET_FROZEN'; request?: MentorWithdrawalRecord };

/**
 * Admin resolves a withdrawal:
 *   APPROVED — the external transfer is done; the PAYOUT hold is marked
 *              COMPLETED (money already left AVAILABLE at request time).
 *   REJECTED — refund: the held amount is returned to AVAILABLE, the hold is
 *              marked REVERSED, and a REVERSAL ledger entry is written.
 * Idempotent: only PENDING requests transition. ALREADY_RESOLVED carries the
 * record so the caller can treat a repeated identical action as a replay.
 */
export async function resolveMentorWithdrawal(input: {
  id: string;
  status: 'APPROVED' | 'REJECTED';
  adminNote?: string | null;
  /** Admin who processed the request (audit). */
  processedByAdminId?: string | null;
  /** Proof of the manual transfer (from /api/upload), settable at approval. */
  receiptUrl?: string | null;
}): Promise<ResolveWithdrawalResult> {
  const { id, status } = input;

  return db.update<ResolveWithdrawalResult>((d) => {
    const request = (d.mentorWithdrawals ?? []).find((r) => r.id === id);
    if (!request) return { ok: false, reason: 'NOT_FOUND' };
    if (request.status !== 'PENDING') return { ok: false, reason: 'ALREADY_RESOLVED', request };

    const wallet = ensureMentorWallet(d, request.mentorId);
    const hold = (d.mentorLedgerTxns ?? []).find((t) => t.id === request.holdTxnId);
    const now = new Date().toISOString();

    if (status === 'APPROVED') {
      if (hold) {
        hold.status = 'COMPLETED';
        hold.completedAt = now;
      }
      request.status = 'APPROVED';
      request.approvedAt = now;
      request.processedByAdminId = input.processedByAdminId ?? null;
      if (input.receiptUrl != null) request.receiptUrl = input.receiptUrl;
      request.adminNote = input.adminNote ?? null;
      request.updatedAt = now;
      return { ok: true, request };
    }

    // REJECTED → refund to AVAILABLE. A frozen wallet can't take the refund;
    // force an unfreeze first rather than silently losing the money.
    if (wallet.status === 'FROZEN') return { ok: false, reason: 'WALLET_FROZEN' };

    wallet.availableBalance += request.amount;
    wallet.updatedAt = now;
    if (hold) {
      hold.status = 'REVERSED';
      hold.completedAt = now;
    }
    const refund = pushTxn(d, {
      id: randomUUID(),
      mentorId: request.mentorId,
      bookingId: null,
      type: 'REVERSAL',
      amount: request.amount,
      bucket: 'AVAILABLE',
      status: 'COMPLETED',
      reference: `mentor-withdrawal-refund-${request.id.slice(0, 8)}`,
      description: 'Withdrawal rejected — refund',
      metadata: { withdrawalId: request.id, adminNote: input.adminNote ?? null },
      createdAt: now,
      completedAt: now,
    });
    request.status = 'REJECTED';
    request.refundTxnId = refund.id;
    request.processedByAdminId = input.processedByAdminId ?? null;
    request.adminNote = input.adminNote ?? null;
    request.updatedAt = now;
    return { ok: true, request };
  });
}
