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
function earningLabel(kind: MentorEarningKind): string {
  return kind === 'PROGRAM' ? 'program' : kind === 'ACADEMY_COURSE' ? 'Academy course' : 'consultation';
}

export function applyMentorEarningToDraft(
  d: StoreDraft,
  input: ApplyMentorEarningInput,
): CreditPendingEarningResult {
  const { mentorId, bookingId, grossAmount } = input;
  // Checked before anything is written: db.update has no rollback.
  if ((input.kind ?? 'CONSULTATION') === 'ACADEMY_COURSE' && input.frozenPlatformRate == null) {
    throw new Error('ACADEMY_COURSE earnings need the frozen Academy share');
  }
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

  // A consultant who owes Metwork for a refunded sale (debtBalance) repays it
  // out of the next money they earn, before any of it becomes withdrawable. The
  // EARNING row below keeps the full net so a replay reads the same split back;
  // the part used to repay sits in its own RECOVERY row.
  const owed = Math.max(0, wallet.debtBalance ?? 0);
  const netted = split.mentorNet > 0 ? Math.min(owed, split.mentorNet) : 0;
  const credited = split.mentorNet - netted;

  if (split.mentorNet > 0) {
    if (bucket === 'AVAILABLE') wallet.availableBalance += credited;
    else wallet.pendingBalance += credited;
    if (netted > 0) wallet.debtBalance = owed - netted;
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
      : kind === 'ACADEMY_COURSE'
        ? 'Academy course sale (held during the 7-day refund window)'
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

  if (netted > 0) {
    pushTxn(d, {
      id: randomUUID(),
      mentorId,
      bookingId,
      type: 'RECOVERY',
      amount: -netted,
      bucket,
      status: 'COMPLETED',
      reference: `mentor-debt-netted-${bookingId}`,
      description: 'Refund balance repaid from this earning',
      metadata: { debtBefore: owed, debtAfter: owed - netted },
      createdAt: now,
      completedAt: now,
    });
  }

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
          ? `Platform share on ${earningLabel(kind)}`
          : `Platform subsidy on ${earningLabel(kind)} (discount absorbed)`,
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
  return db.update<ReleaseEarningResult>((d) => releaseEarningInDraft(d, input));
}

/**
 * {@link releaseToAvailable} inside an already-open `db.update`. `description`
 * names the event for the ledger (default: a completed consultation).
 */
export function releaseEarningInDraft(
  d: StoreDraft,
  input: { mentorId: string; bookingId: string; description?: string },
): ReleaseEarningResult {
  const { mentorId, bookingId } = input;
  const releaseRef = `mentor-release-${bookingId}`;
  const earningRef = `mentor-earning-${bookingId}`;
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
    description: input.description ?? 'Consultation earning released after completion',
    metadata: { earningTxnId: earning.id },
    createdAt: now,
    completedAt: now,
  });

  return { ok: true, replayed: false, wallet, released: amount };
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
  return db.update<VoidEarningResult>((d) => voidPendingEarningInDraft(d, input));
}

/**
 * {@link voidPendingEarning} inside an already-open `db.update` (a refund
 * voids the earning in the same write that returns the money). `description`
 * names the event for the ledger (default: a cancelled consultation).
 */
export function voidPendingEarningInDraft(
  d: StoreDraft,
  input: { mentorId: string; bookingId: string; description?: string },
): VoidEarningResult {
  const { mentorId, bookingId } = input;
  const reversalRef = `mentor-reversal-${bookingId}`;
  const releaseRef = `mentor-release-${bookingId}`;
  const earningRef = `mentor-earning-${bookingId}`;
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
    description: input.description ?? 'Consultation earning voided (cancelled before completion)',
    metadata: { earningTxnId: earning.id },
    createdAt: now,
    completedAt: now,
  });

  return { ok: true, replayed: false, wallet, voided: amount };
}

/* ───────────────────────────── Refunded sale ───────────────────────────── */

export type ReverseSaleResult =
  | {
      ok: true;
      replayed: boolean;
      /** What the consultant was credited for this sale (0 when nothing was). */
      reversed: number;
      fromAvailable: number;
      fromPending: number;
      /** Amount the consultant now owes because they had already withdrawn it. */
      debtAdded: number;
      /** Amount settled outside the platform (consultant repaid Metwork directly). */
      recoveredOffPlatform: number;
    }
  | { ok: false; reason: 'NO_EARNING' };

/**
 * Undo a refunded sale in the consultant ledger: the EARNING is marked REVERSED,
 * the COMMISSION audit row is marked REVERSED (so the revenue summary stops
 * counting the platform's cut), and the credited amount is taken back.
 *
 * Where the money comes from, in order: the bucket the earning sits in (PENDING
 * until released, AVAILABLE for programs and released consultations), then the
 * other bucket, then whatever is left becomes `debtBalance`. Consequently a debt
 * only exists while both balances are 0, which is what makes "netted against the
 * next earning" safe.
 *
 * `recoveredOffPlatform` is for a refund that was settled by hand before this
 * existed: the consultant already sent Metwork the money, so the wallet is left
 * untouched, no debt is recorded, and a RECOVERY row says why.
 *
 * Does NOT use `voidPendingEarningInDraft`: that only reduces PENDING, which is
 * wrong for a program earning credited straight to AVAILABLE.
 */
export function reverseSaleInDraft(
  d: StoreDraft,
  input: {
    mentorId: string;
    bookingId: string;
    refundRequestId?: string | null;
    recoveredOffPlatform?: boolean;
    description?: string;
  },
): ReverseSaleResult {
  const { mentorId, bookingId } = input;
  const reversalRef = `mentor-sale-reversal-${bookingId}`;
  const wallet = ensureMentorWallet(d, mentorId);

  const prior = findByReference(d, mentorId, reversalRef);
  if (prior) {
    const m = prior.metadata as {
      fromAvailable?: number; fromPending?: number; debtAdded?: number; recoveredOffPlatform?: number;
    };
    return {
      ok: true,
      replayed: true,
      reversed: -prior.amount,
      fromAvailable: m.fromAvailable ?? 0,
      fromPending: m.fromPending ?? 0,
      debtAdded: m.debtAdded ?? 0,
      recoveredOffPlatform: m.recoveredOffPlatform ?? 0,
    };
  }

  const earning = findByReference(d, mentorId, `mentor-earning-${bookingId}`);
  if (!earning || earning.type !== 'EARNING') return { ok: false, reason: 'NO_EARNING' };
  // Already voided through the consultation-cancel path: nothing left to take.
  if (earning.status === 'REVERSED') {
    return { ok: true, replayed: true, reversed: 0, fromAvailable: 0, fromPending: 0, debtAdded: 0, recoveredOffPlatform: 0 };
  }

  const now = new Date().toISOString();
  const net = Math.max(0, earning.amount);
  const released = Boolean(findByReference(d, mentorId, `mentor-release-${bookingId}`));
  const startsPending = earning.bucket === 'PENDING' && !released;

  let fromAvailable = 0;
  let fromPending = 0;
  let debtAdded = 0;
  let recovered = 0;

  if (input.recoveredOffPlatform) {
    recovered = net;
  } else {
    let left = net;
    const takePending = () => {
      const t = Math.min(wallet.pendingBalance, left);
      wallet.pendingBalance -= t; fromPending += t; left -= t;
    };
    const takeAvailable = () => {
      const t = Math.min(wallet.availableBalance, left);
      wallet.availableBalance -= t; fromAvailable += t; left -= t;
    };
    if (startsPending) { takePending(); takeAvailable(); } else { takeAvailable(); takePending(); }
    debtAdded = left;
    if (debtAdded > 0) wallet.debtBalance = Math.max(0, wallet.debtBalance ?? 0) + debtAdded;
  }
  wallet.updatedAt = now;

  earning.status = 'REVERSED';
  const commission = findByReference(d, mentorId, `mentor-commission-${bookingId}`);
  if (commission) {
    commission.status = 'REVERSED';
    commission.metadata = { ...commission.metadata, reversedAt: now, refundRequestId: input.refundRequestId ?? null };
  }

  pushTxn(d, {
    id: randomUUID(),
    mentorId,
    bookingId,
    type: 'REVERSAL',
    amount: -net,
    bucket: startsPending ? 'PENDING' : 'AVAILABLE',
    status: 'COMPLETED',
    reference: reversalRef,
    description: input.description ?? 'Sale refunded to the client',
    metadata: {
      earningTxnId: earning.id,
      refundRequestId: input.refundRequestId ?? null,
      fromAvailable, fromPending, debtAdded, recoveredOffPlatform: recovered,
    },
    createdAt: now,
    completedAt: now,
  });

  if (recovered > 0) {
    pushTxn(d, {
      id: randomUUID(),
      mentorId,
      bookingId,
      type: 'RECOVERY',
      amount: recovered,
      bucket: 'AVAILABLE',
      status: 'COMPLETED',
      reference: `mentor-sale-recovery-${bookingId}`,
      description: 'Refunded amount returned to Metwork outside the platform',
      metadata: { refundRequestId: input.refundRequestId ?? null },
      createdAt: now,
      completedAt: now,
    });
  }

  return { ok: true, replayed: false, reversed: net, fromAvailable, fromPending, debtAdded, recoveredOffPlatform: recovered };
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
