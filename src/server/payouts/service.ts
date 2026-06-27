/**
 * Automated SlickPay payouts (disbursement of approved withdrawals to a RIB).
 *
 * This is the SINGLE orchestration for the SlickPay money path. The external
 * disbursement is ON the money path: the escrow hold (reserved at request time)
 * is only SETTLED once SlickPay confirms `completed=1` ("sent"). On failure the
 * hold stays reserved (wallet untouched) and the payout is marked FAILED
 * (retryable). A double-click / retry never sends twice — the `PROCESSING`
 * status set inside an atomic `db.update` claim is the dedupe guard, and an
 * existing `payoutProviderRef` is never re-created.
 *
 * Two ledgers (kept deliberately separate — see CLAUDE.md / mentor ledger):
 *   • user wallet   → WithdrawalRequestRecord + TransactionRecord hold
 *   • mentor ledger → MentorWithdrawalRecord  + MentorLedgerTxnRecord hold
 * Both reuse ONE canonical dispatch sequence ({@link executeSlickpayDispatch})
 * and ONE SlickPay client (slickpay-provider.ts); only the ledger mutations differ.
 */
import { randomUUID } from 'node:crypto';
import {
  db,
  type PayoutBankAccount,
  type PayoutBeneficiary,
  type TransactionRecord,
  type WithdrawalRequestRecord,
} from '@/server/db/store';
import {
  createSlickpayBeneficiary,
  createSlickpayDisbursement,
  getSlickPayTransferStatus,
  getSlickpayTransferCommission,
} from '@/server/payments/slickpay-provider';
import { ProviderNotConfiguredError } from '@/server/payments/errors';
import { requestMentorWithdrawal } from '@/server/mentors/ledger';
import { clientEnvVars } from '@/lib/env';

/** Smallest payout, server-enforced. Mirrors the withdrawal-request floor. */
export const MIN_PAYOUT = 500;

/** An Algerian RIB is exactly 20 digits (spaces tolerated on input). */
export function isValidRib(rib: string): boolean {
  return /^\d{20}$/.test(rib.replace(/\s+/g, ''));
}

/** Normalise a beneficiary for storage + SlickPay (RIB stripped to 20 digits). */
export function normalizeBeneficiary(b: PayoutBeneficiary): PayoutBeneficiary {
  return {
    rib: b.rib.replace(/\s+/g, ''),
    firstname: b.firstname.trim(),
    lastname: b.lastname.trim(),
    address: b.address.trim(),
  };
}

/** Mask a RIB to its last 4 digits for client display, e.g. `****6789`. Never ship raw. */
export function maskRib(rib: string): string {
  const digits = rib.replace(/\s+/g, '');
  return digits.length >= 4 ? `****${digits.slice(-4)}` : '****';
}

/** SlickPay requires a `url` on transfers; for a payout there is no payer redirect. */
function payoutReturnUrl(): string {
  const base = clientEnvVars.NEXT_PUBLIC_APP_URL.replace(/\/$/, '');
  return `${base}/en/dashboard/admin/payments`;
}

/** Best-effort SlickPay fee for accounting. Never blocks the payout. */
async function bestEffortFee(amount: number): Promise<number | null> {
  try {
    const { commission } = await getSlickpayTransferCommission(amount);
    return Number.isFinite(commission) ? commission : null;
  } catch {
    return null;
  }
}

export type PayoutDispatchOutcome =
  | { ok: true; finalStatus: 'SENT' | 'PROCESSING'; redirectUrl: string | null }
  | { ok: false; reason: 'DISPATCH_FAILED'; message: string };

/**
 * Ledger-agnostic adapter the canonical dispatch drives. The closures own the
 * ledger-specific atomic mutations; the dispatch owns the SlickPay calls,
 * ordering and idempotency.
 */
interface PayoutAdapter {
  amount: number;
  beneficiary: PayoutBeneficiary;
  /** Refs captured at claim time — set on a retry so we never re-create. */
  existingProviderRef: string | null;
  existingAccountUuid: string | null;
  persistRefs(p: { providerRef: string; accountUuid: string; redirectUrl: string | null }): Promise<void>;
  markFailed(reason: string): Promise<void>;
  /** Settle the hold + mark SENT, idempotently (no-op if not still PROCESSING). */
  finalizeSent(fee: number | null): Promise<void>;
}

/**
 * THE canonical SlickPay dispatch. Creates the beneficiary + transfer (once),
 * then polls status once; reconcile finalizes later if still pending.
 */
async function executeSlickpayDispatch(a: PayoutAdapter): Promise<PayoutDispatchOutcome> {
  let providerRef = a.existingProviderRef;
  let accountUuid = a.existingAccountUuid;
  let redirectUrl: string | null = null;

  // Create the transfer exactly once. A retry with an existing providerRef
  // skips creation and only re-checks status — never a second send.
  //
  // markFailed is called ONLY before a transfer is created: once SlickPay
  // returns a transfer id we persist the ref and proceed: a later transient
  // error leaves the payout PROCESSING (ref saved) for the reconciler, so a
  // retry polls the existing transfer instead of sending a second time.
  if (!providerRef) {
    if (!accountUuid) {
      try {
        accountUuid = (await createSlickpayBeneficiary(a.beneficiary)).uuid;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'SlickPay beneficiary creation failed';
        await a.markFailed(message);
        return { ok: false, reason: 'DISPATCH_FAILED', message };
      }
    }
    try {
      const disb = await createSlickpayDisbursement({
        amount: a.amount,
        accountUuid,
        returnUrl: payoutReturnUrl(),
      });
      providerRef = disb.transferId;
      redirectUrl = disb.redirectUrl;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'SlickPay dispatch failed';
      await a.markFailed(message);
      return { ok: false, reason: 'DISPATCH_FAILED', message };
    }
    await a.persistRefs({ providerRef, accountUuid, redirectUrl });
  }

  // Status check. Transient errors leave the payout PROCESSING for the cron
  // reconciler — they are NOT failures (the money may well be in flight).
  // SLICKPAY-CONFIRM: a returned redirectUrl means interactive validation is
  // needed — we stay PROCESSING and hand the URL back for the UI to surface.
  let sent = false;
  try {
    sent = (await getSlickPayTransferStatus(providerRef)).completed === 1;
  } catch {
    return { ok: true, finalStatus: 'PROCESSING', redirectUrl };
  }
  if (!sent) return { ok: true, finalStatus: 'PROCESSING', redirectUrl };

  const fee = await bestEffortFee(a.amount);
  await a.finalizeSent(fee);
  return { ok: true, finalStatus: 'SENT', redirectUrl: null };
}

/* ─────────────────────────── User-wallet payouts ─────────────────────────── */

export type ProcessPayoutResult =
  | { ok: true; finalStatus: 'SENT' | 'PROCESSING'; redirectUrl: string | null }
  | {
      ok: false;
      reason:
        | 'NOT_FOUND'
        | 'NOT_PENDING'
        | 'ALREADY_PROCESSING'
        | 'INVALID_RIB'
        | 'DISPATCH_FAILED';
      message?: string;
    };

/** Optional overrides shared by both process functions (used by sendTransfer). */
interface ProcessPayoutOptions {
  requestId: string;
  beneficiary: PayoutBeneficiary;
  adminNote?: string | null;
  /** External idempotency key (e.g. admin double-click guard). Falls back to `payout-<id>`. */
  idempotencyKey?: string | null;
  /** Admin who initiated this payout (audit). */
  adminId?: string | null;
  /** Pre-registered SlickPay beneficiary uuid (on-file account) — skips re-creation. */
  existingAccountUuid?: string | null;
}

type UserClaim =
  | { ok: true; amount: number; existingProviderRef: string | null; existingAccountUuid: string | null }
  | { ok: false; reason: 'NOT_FOUND' | 'NOT_PENDING' | 'ALREADY_PROCESSING' };

/**
 * Run an automated SlickPay payout for a user-wallet withdrawal. Atomically
 * claims the request (PENDING/FAILED → PROCESSING), dispatches, and settles the
 * hold on "sent".
 */
export async function processUserSlickpayPayout(input: ProcessPayoutOptions): Promise<ProcessPayoutResult> {
  const beneficiary = normalizeBeneficiary(input.beneficiary);
  if (!isValidRib(beneficiary.rib)) return { ok: false, reason: 'INVALID_RIB' };

  const claim = await db.update<UserClaim>((d) => {
    const r = d.withdrawalRequests.find((x) => x.id === input.requestId);
    if (!r) return { ok: false, reason: 'NOT_FOUND' };
    if (r.status !== 'PENDING') return { ok: false, reason: 'NOT_PENDING' };
    if (r.payoutStatus === 'PROCESSING') return { ok: false, reason: 'ALREADY_PROCESSING' };

    const now = new Date().toISOString();
    r.payoutMethod = 'SLICKPAY';
    r.beneficiary = beneficiary;
    r.ribApproved = true;
    r.payoutStatus = 'PROCESSING';
    r.payoutFailureReason = null;
    if (input.adminNote !== undefined) r.adminNote = input.adminNote;
    if (input.adminId != null) r.payoutCreatedByAdminId = input.adminId;
    r.payoutIdempotencyKey = input.idempotencyKey ?? r.payoutIdempotencyKey ?? `payout-${r.id}`;
    r.updatedAt = now;
    return {
      ok: true,
      amount: r.amount,
      existingProviderRef: r.payoutProviderRef ?? null,
      existingAccountUuid: r.payoutAccountUuid ?? input.existingAccountUuid ?? null,
    };
  });

  if (!claim.ok) return claim;

  const outcome = await executeSlickpayDispatch({
    amount: claim.amount,
    beneficiary,
    existingProviderRef: claim.existingProviderRef,
    existingAccountUuid: claim.existingAccountUuid,
    persistRefs: ({ providerRef, accountUuid, redirectUrl }) =>
      db.update((d) => {
        const r = d.withdrawalRequests.find((x) => x.id === input.requestId);
        if (!r) return;
        r.payoutProviderRef = providerRef;
        r.payoutAccountUuid = accountUuid;
        r.payoutRedirectUrl = redirectUrl;
        r.updatedAt = new Date().toISOString();
      }),
    markFailed: (reason) =>
      db.update((d) => {
        const r = d.withdrawalRequests.find((x) => x.id === input.requestId);
        if (!r || r.payoutStatus !== 'PROCESSING') return;
        r.payoutStatus = 'FAILED';
        r.payoutFailureReason = reason;
        r.updatedAt = new Date().toISOString();
      }),
    finalizeSent: (fee) => finalizeUserPayoutSent(input.requestId, fee),
  });

  if (!outcome.ok) return outcome;
  return { ok: true, finalStatus: outcome.finalStatus, redirectUrl: outcome.redirectUrl };
}

/** Settle a user-wallet payout's hold + mark SENT. Idempotent (PROCESSING-only). */
async function finalizeUserPayoutSent(requestId: string, fee: number | null): Promise<void> {
  await db.update((d) => {
    const r = d.withdrawalRequests.find((x) => x.id === requestId);
    if (!r || r.payoutStatus !== 'PROCESSING') return;
    const now = new Date().toISOString();
    const hold = d.transactions.find((t) => t.id === r.holdTransactionId);
    if (hold) {
      hold.status = 'COMPLETED';
      hold.completedAt = now;
    }
    r.status = 'APPROVED';
    r.payoutStatus = 'SENT';
    r.payoutFee = fee;
    r.payoutRedirectUrl = null;
    r.updatedAt = now;
  });
}

/* ─────────────────────────── Mentor-ledger payouts ─────────────────────────── */

type MentorClaim =
  | { ok: true; amount: number; existingProviderRef: string | null; existingAccountUuid: string | null }
  | { ok: false; reason: 'NOT_FOUND' | 'NOT_PENDING' | 'ALREADY_PROCESSING' };

/** Run an automated SlickPay payout for a consultant (mentor-ledger) withdrawal. */
export async function processMentorSlickpayPayout(input: ProcessPayoutOptions): Promise<ProcessPayoutResult> {
  const beneficiary = normalizeBeneficiary(input.beneficiary);
  if (!isValidRib(beneficiary.rib)) return { ok: false, reason: 'INVALID_RIB' };

  const claim = await db.update<MentorClaim>((d) => {
    const r = (d.mentorWithdrawals ?? []).find((x) => x.id === input.requestId);
    if (!r) return { ok: false, reason: 'NOT_FOUND' };
    if (r.status !== 'PENDING') return { ok: false, reason: 'NOT_PENDING' };
    if (r.payoutStatus === 'PROCESSING') return { ok: false, reason: 'ALREADY_PROCESSING' };

    const now = new Date().toISOString();
    r.payoutMethod = 'SLICKPAY';
    r.beneficiary = beneficiary;
    r.ribApproved = true;
    r.payoutStatus = 'PROCESSING';
    r.payoutFailureReason = null;
    if (input.adminNote !== undefined) r.adminNote = input.adminNote;
    if (input.adminId != null) r.payoutCreatedByAdminId = input.adminId;
    r.payoutIdempotencyKey = input.idempotencyKey ?? r.payoutIdempotencyKey ?? `payout-${r.id}`;
    r.updatedAt = now;
    return {
      ok: true,
      amount: r.amount,
      existingProviderRef: r.payoutProviderRef ?? null,
      existingAccountUuid: r.payoutAccountUuid ?? input.existingAccountUuid ?? null,
    };
  });

  if (!claim.ok) return claim;

  const outcome = await executeSlickpayDispatch({
    amount: claim.amount,
    beneficiary,
    existingProviderRef: claim.existingProviderRef,
    existingAccountUuid: claim.existingAccountUuid,
    persistRefs: ({ providerRef, accountUuid, redirectUrl }) =>
      db.update((d) => {
        const r = (d.mentorWithdrawals ?? []).find((x) => x.id === input.requestId);
        if (!r) return;
        r.payoutProviderRef = providerRef;
        r.payoutAccountUuid = accountUuid;
        r.payoutRedirectUrl = redirectUrl;
        r.updatedAt = new Date().toISOString();
      }),
    markFailed: (reason) =>
      db.update((d) => {
        const r = (d.mentorWithdrawals ?? []).find((x) => x.id === input.requestId);
        if (!r || r.payoutStatus !== 'PROCESSING') return;
        r.payoutStatus = 'FAILED';
        r.payoutFailureReason = reason;
        r.updatedAt = new Date().toISOString();
      }),
    finalizeSent: (fee) => finalizeMentorPayoutSent(input.requestId, fee),
  });

  if (!outcome.ok) return outcome;
  return { ok: true, finalStatus: outcome.finalStatus, redirectUrl: outcome.redirectUrl };
}

/** Settle a mentor payout's hold + mark SENT. Idempotent (PROCESSING-only). */
async function finalizeMentorPayoutSent(requestId: string, fee: number | null): Promise<void> {
  await db.update((d) => {
    const r = (d.mentorWithdrawals ?? []).find((x) => x.id === requestId);
    if (!r || r.payoutStatus !== 'PROCESSING') return;
    const now = new Date().toISOString();
    const hold = (d.mentorLedgerTxns ?? []).find((t) => t.id === r.holdTxnId);
    if (hold) {
      hold.status = 'COMPLETED';
      hold.completedAt = now;
    }
    r.status = 'APPROVED';
    r.payoutStatus = 'SENT';
    r.payoutFee = fee;
    r.payoutRedirectUrl = null;
    r.updatedAt = now;
  });
}

/* ─────────────────────────── Reconciliation ─────────────────────────── */

/** PROCESSING with no providerRef this long ⇒ dispatch crashed → flag for review. */
const STUCK_DISPATCH_MS = 15 * 60_000;

/**
 * Safety net for SlickPay payouts whose "sent" confirmation never arrived back
 * to the admin request (async settlement). Polls every PROCESSING payout that
 * has a `payoutProviderRef` and settles idempotently. Payouts stuck in
 * PROCESSING with NO providerRef (a dispatch that crashed mid-create) are flagged
 * FAILED for manual review after {@link STUCK_DISPATCH_MS} — never auto-resent,
 * to avoid a double-send. No-ops when SlickPay isn't configured (mock/dev).
 */
export async function reconcilePendingPayouts(): Promise<{
  checked: number;
  settled: number;
  failed: number;
}> {
  const data = await db.read();
  const now = Date.now();

  const userPending = (data.withdrawalRequests ?? []).filter((r) => r.payoutStatus === 'PROCESSING');
  const mentorPending = (data.mentorWithdrawals ?? []).filter((r) => r.payoutStatus === 'PROCESSING');

  let settled = 0;
  let failed = 0;

  const handle = async (
    rows: { id: string; amount: number; payoutProviderRef?: string | null; updatedAt: string }[],
    finalize: (id: string, fee: number | null) => Promise<void>,
    markStuck: (id: string) => Promise<void>,
  ): Promise<boolean> => {
    for (const r of rows) {
      if (!r.payoutProviderRef) {
        if (now - Date.parse(r.updatedAt) > STUCK_DISPATCH_MS) {
          await markStuck(r.id);
          failed += 1;
        }
        continue;
      }
      let sent: boolean;
      try {
        sent = (await getSlickPayTransferStatus(r.payoutProviderRef)).completed === 1;
      } catch (err) {
        if (err instanceof ProviderNotConfiguredError) return false; // mock/dev — stop
        failed += 1;
        continue;
      }
      if (!sent) continue;
      const fee = await bestEffortFee(r.amount);
      await finalize(r.id, fee);
      settled += 1;
    }
    return true;
  };

  const cont = await handle(
    userPending,
    finalizeUserPayoutSent,
    (id) => markStuckPayout('user', id),
  );
  if (cont) {
    await handle(mentorPending, finalizeMentorPayoutSent, (id) => markStuckPayout('mentor', id));
  }

  return { checked: userPending.length + mentorPending.length, settled, failed };
}

async function markStuckPayout(kind: 'user' | 'mentor', id: string): Promise<void> {
  await db.update((d) => {
    const rows = kind === 'user' ? d.withdrawalRequests : (d.mentorWithdrawals ?? []);
    const r = rows.find((x) => x.id === id);
    if (!r || r.payoutStatus !== 'PROCESSING' || r.payoutProviderRef) return;
    r.payoutStatus = 'FAILED';
    r.payoutFailureReason =
      'SlickPay dispatch did not complete. Verify in the SlickPay dashboard before retrying.';
    r.updatedAt = new Date().toISOString();
  });
}

/* ═══════════════════════════ Admin payouts dashboard ═══════════════════════════
 * Bank-account-on-file model: a payable target (user or mentor) registers a RIB
 * once (→ SlickPay beneficiary uuid cached on the record), and admins send
 * transfers to it. The masked RIB is the only RIB shape ever returned to the
 * client. Reuses the canonical send engine above. */

export type PayoutTargetType = 'user' | 'mentor';

export interface BankAccountMasked {
  title: string;
  firstname: string;
  lastname: string;
  address: string;
  /** Last-4 only, e.g. `****6789`. Never the raw RIB. */
  ribMasked: string;
}

export interface PayableTarget {
  /** UserRecord.id or MentorRecord.id. */
  id: string;
  type: PayoutTargetType;
  name: string;
  /** UserRole for users; 'MENTOR' for mentors. */
  role: string;
  /** Spendable balance: wallet.balance (user) or availableBalance (mentor). */
  balance: number;
  bankAccount: BankAccountMasked | null;
}

function maskBankAccount(b: PayoutBankAccount): BankAccountMasked {
  return {
    title: b.title,
    firstname: b.firstname,
    lastname: b.lastname,
    address: b.address,
    ribMasked: maskRib(b.rib),
  };
}

/**
 * Payable targets for the admin Users tab: every user with a wallet + every
 * mentor with an earnings wallet, with balance + masked bank-account status.
 * Optional case-insensitive name search and role filter.
 */
export async function getPayableTargets(opts: { search?: string; role?: string } = {}): Promise<PayableTarget[]> {
  const data = await db.read();
  const search = (opts.search ?? '').trim().toLowerCase();
  const roleFilter = (opts.role ?? '').trim().toUpperCase();

  const usersById = new Map((data.users ?? []).map((u) => [u.id, u]));
  const mentorsById = new Map((data.mentors ?? []).map((m) => [m.id, m]));

  const targets: PayableTarget[] = [];

  for (const w of data.wallets ?? []) {
    const u = usersById.get(w.userId);
    if (!u) continue;
    targets.push({
      id: u.id,
      type: 'user',
      name: u.fullName ?? u.email,
      role: u.role,
      balance: w.balance,
      bankAccount: u.payoutBankAccount ? maskBankAccount(u.payoutBankAccount) : null,
    });
  }

  for (const mw of data.mentorWallets ?? []) {
    const m = mentorsById.get(mw.mentorId);
    if (!m) continue;
    targets.push({
      id: m.id,
      type: 'mentor',
      name: m.fullName,
      role: 'MENTOR',
      balance: mw.availableBalance,
      bankAccount: m.payoutBankAccount ? maskBankAccount(m.payoutBankAccount) : null,
    });
  }

  return targets
    .filter((t) => (search ? t.name.toLowerCase().includes(search) : true))
    .filter((t) => (roleFilter ? t.role.toUpperCase() === roleFilter : true))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type RegisterContactResult =
  | { ok: true; bankAccount: BankAccountMasked; slickpayRegistered: boolean }
  | { ok: false; reason: 'INVALID_RIB' | 'TARGET_NOT_FOUND' | 'SLICKPAY_ERROR'; message?: string };

/**
 * Register / update a target's payout bank account. Idempotent: re-registers
 * with SlickPay only when there is no cached uuid OR the RIB changed; otherwise
 * just updates the holder details. Gracefully degrades when SlickPay is not
 * configured (dev) — stores the account with a null uuid so the UI still works.
 */
export async function registerPayoutContact(input: {
  targetType: PayoutTargetType;
  targetId: string;
  bankAccount: PayoutBankAccount;
}): Promise<RegisterContactResult> {
  const rib = input.bankAccount.rib.replace(/\s+/g, '');
  if (!isValidRib(rib)) return { ok: false, reason: 'INVALID_RIB' };

  const bankAccount: PayoutBankAccount = {
    title: input.bankAccount.title.trim(),
    firstname: input.bankAccount.firstname.trim(),
    lastname: input.bankAccount.lastname.trim(),
    address: input.bankAccount.address.trim(),
    rib,
  };

  const data = await db.read();
  const target =
    input.targetType === 'user'
      ? (data.users ?? []).find((u) => u.id === input.targetId)
      : (data.mentors ?? []).find((m) => m.id === input.targetId);
  if (!target) return { ok: false, reason: 'TARGET_NOT_FOUND' };

  const existingUuid = target.slickpayBeneficiaryUuid ?? null;
  const existingRib = target.payoutBankAccount?.rib ?? null;
  const email = 'email' in target ? (target.email ?? undefined) : undefined;

  let uuid: string | null = existingUuid;
  let slickpayRegistered = !!existingUuid;

  // Register with SlickPay when there is no uuid yet, or the RIB changed.
  if (!existingUuid || existingRib !== rib) {
    try {
      uuid = (
        await createSlickpayBeneficiary({
          rib,
          firstname: bankAccount.firstname,
          lastname: bankAccount.lastname,
          address: bankAccount.address,
          title: bankAccount.title,
          email,
        })
      ).uuid;
      slickpayRegistered = true;
    } catch (err) {
      if (err instanceof ProviderNotConfiguredError) {
        // Dev/mock — store the account without a uuid; the send path will
        // create the beneficiary lazily once SlickPay is configured.
        uuid = null;
        slickpayRegistered = false;
      } else {
        return {
          ok: false,
          reason: 'SLICKPAY_ERROR',
          message: err instanceof Error ? err.message : 'SlickPay beneficiary registration failed',
        };
      }
    }
  }

  await db.update((d) => {
    const rec =
      input.targetType === 'user'
        ? (d.users ?? []).find((u) => u.id === input.targetId)
        : (d.mentors ?? []).find((m) => m.id === input.targetId);
    if (!rec) return;
    rec.payoutBankAccount = bankAccount;
    rec.slickpayBeneficiaryUuid = uuid;
    if ('updatedAt' in rec) rec.updatedAt = new Date().toISOString();
  });

  return { ok: true, bankAccount: maskBankAccount(bankAccount), slickpayRegistered };
}

export type PreviewTransferResult =
  | { ok: true; amount: number; fee: number | null; beneficiaryReceives: number }
  | { ok: false; reason: 'BELOW_MINIMUM'; minimum: number };

/**
 * Fee preview for the New Transfer modal. The beneficiary always receives the
 * full `amount` (the SlickPay fee is platform-borne); `fee` is the platform cost.
 */
export async function previewTransfer(amount: number): Promise<PreviewTransferResult> {
  const amt = Math.round(amount);
  if (!Number.isFinite(amt) || amt < MIN_PAYOUT) {
    return { ok: false, reason: 'BELOW_MINIMUM', minimum: MIN_PAYOUT };
  }
  const fee = await bestEffortFee(amt);
  return { ok: true, amount: amt, fee, beneficiaryReceives: amt };
}

export type SendTransferResult =
  | { ok: true; finalStatus: 'SENT' | 'PROCESSING'; redirectUrl: string | null; requestId: string; replayed: boolean }
  | {
      ok: false;
      reason:
        | 'BELOW_MINIMUM'
        | 'NO_BANK_ACCOUNT'
        | 'TARGET_NOT_FOUND'
        | 'INSUFFICIENT_FUNDS'
        | 'WALLET_FROZEN'
        | 'REQUEST_NOT_FOUND'
        | 'NOT_PENDING'
        | 'ALREADY_PROCESSING'
        | 'INVALID_RIB'
        | 'DISPATCH_FAILED';
      message?: string;
      balance?: number;
    };

/**
 * The single admin "send money" entry point. Works for a direct transfer (Users
 * tab — reserves a withdrawal at send time) or for processing an existing
 * withdrawal request (Requests tab — uses its reserved hold). Hard guards:
 * amount ≥ 500 and a bank account on file. Idempotent on `idempotencyKey`.
 */
export async function sendTransfer(input: {
  targetType: PayoutTargetType;
  targetId: string;
  amount: number;
  idempotencyKey: string;
  adminId: string;
  withdrawalRequestId?: string | null;
}): Promise<SendTransferResult> {
  const amount = Math.round(input.amount);
  if (!Number.isFinite(amount) || amount < MIN_PAYOUT) {
    return { ok: false, reason: 'BELOW_MINIMUM' };
  }

  const data = await db.read();
  const target =
    input.targetType === 'user'
      ? (data.users ?? []).find((u) => u.id === input.targetId)
      : (data.mentors ?? []).find((m) => m.id === input.targetId);
  if (!target) return { ok: false, reason: 'TARGET_NOT_FOUND' };

  const bank = target.payoutBankAccount;
  if (!bank || !isValidRib(bank.rib)) return { ok: false, reason: 'NO_BANK_ACCOUNT' };
  const beneficiary: PayoutBeneficiary = {
    rib: bank.rib,
    firstname: bank.firstname,
    lastname: bank.lastname,
    address: bank.address,
  };
  const existingAccountUuid = target.slickpayBeneficiaryUuid ?? null;

  // Idempotency: a non-failed payout already exists for this key → return it.
  const pool =
    input.targetType === 'user' ? data.withdrawalRequests ?? [] : data.mentorWithdrawals ?? [];
  const dup = pool.find((r) => r.payoutIdempotencyKey === input.idempotencyKey && r.payoutStatus !== 'FAILED');
  if (dup) {
    return {
      ok: true,
      finalStatus: dup.payoutStatus === 'SENT' ? 'SENT' : 'PROCESSING',
      redirectUrl: dup.payoutRedirectUrl ?? null,
      requestId: dup.id,
      replayed: true,
    };
  }

  // Resolve the withdrawal request to pay: an existing one, or reserve a new one.
  let requestId: string;
  if (input.withdrawalRequestId) {
    const existing = pool.find((r) => r.id === input.withdrawalRequestId);
    if (!existing) return { ok: false, reason: 'REQUEST_NOT_FOUND' };
    if (existing.status !== 'PENDING') return { ok: false, reason: 'NOT_PENDING' };
    requestId = existing.id;
  } else {
    const accountDetails = `RIB ${maskRib(bank.rib)} — ${bank.firstname} ${bank.lastname}`.trim();
    const reserved =
      input.targetType === 'user'
        ? await reserveUserDirectWithdrawal({ userId: input.targetId, amount, accountDetails, adminId: input.adminId, idempotencyKey: input.idempotencyKey })
        : await reserveMentorDirectWithdrawal({ mentorId: input.targetId, amount, accountDetails, adminId: input.adminId, idempotencyKey: input.idempotencyKey });
    if (!reserved.ok) return reserved;
    requestId = reserved.requestId;
  }

  const opts: ProcessPayoutOptions = {
    requestId,
    beneficiary,
    idempotencyKey: input.idempotencyKey,
    adminId: input.adminId,
    existingAccountUuid,
  };
  const res =
    input.targetType === 'user'
      ? await processUserSlickpayPayout(opts)
      : await processMentorSlickpayPayout(opts);

  if (!res.ok) {
    // requestId was just reserved/verified above, so NOT_FOUND shouldn't happen;
    // map it defensively rather than leak a reason outside SendTransferResult.
    const reason = res.reason === 'NOT_FOUND' ? 'REQUEST_NOT_FOUND' : res.reason;
    return { ok: false, reason, message: res.message };
  }
  return { ok: true, finalStatus: res.finalStatus, redirectUrl: res.redirectUrl, requestId, replayed: false };
}

type ReserveResult =
  | { ok: true; requestId: string }
  | { ok: false; reason: 'INSUFFICIENT_FUNDS' | 'WALLET_FROZEN'; balance?: number };

/** Atomically reserve a user wallet payout (admin-direct). Idempotent on `idempotencyKey`. */
async function reserveUserDirectWithdrawal(input: {
  userId: string;
  amount: number;
  accountDetails: string;
  adminId: string;
  idempotencyKey: string;
}): Promise<ReserveResult> {
  return db.update<ReserveResult>((d) => {
    const dup = d.withdrawalRequests.find((r) => r.payoutIdempotencyKey === input.idempotencyKey);
    if (dup) return { ok: true, requestId: dup.id };

    const wallet = d.wallets.find((w) => w.userId === input.userId);
    if (!wallet) return { ok: false, reason: 'INSUFFICIENT_FUNDS', balance: 0 };
    if (wallet.status === 'FROZEN') return { ok: false, reason: 'WALLET_FROZEN' };
    if (wallet.balance < input.amount) {
      return { ok: false, reason: 'INSUFFICIENT_FUNDS', balance: wallet.balance };
    }

    const now = new Date().toISOString();
    wallet.balance -= input.amount;
    wallet.updatedAt = now;

    const hold: TransactionRecord = {
      id: randomUUID(),
      walletId: wallet.id,
      userId: input.userId,
      type: 'PAYOUT',
      amount: -input.amount,
      balanceAfter: wallet.balance,
      status: 'PENDING',
      description: `Admin payout — ${input.amount.toLocaleString()} DZD`,
      reference: `withdrawal-hold-${randomUUID().slice(0, 8)}`,
      provider: 'internal',
      providerTxnId: null,
      metadata: { accountDetails: input.accountDetails, adminId: input.adminId },
      createdAt: now,
      completedAt: null,
    };
    d.transactions.push(hold);

    const req: WithdrawalRequestRecord = {
      id: randomUUID(),
      userId: input.userId,
      amount: input.amount,
      accountDetails: input.accountDetails,
      status: 'PENDING',
      holdTransactionId: hold.id,
      payoutSource: 'ADMIN_DIRECT',
      payoutCreatedByAdminId: input.adminId,
      payoutIdempotencyKey: input.idempotencyKey,
      createdAt: now,
      updatedAt: now,
    };
    d.withdrawalRequests.push(req);
    return { ok: true, requestId: req.id };
  });
}

/** Reserve a mentor-ledger payout (admin-direct). Reuses the ledger's escrow helper. */
async function reserveMentorDirectWithdrawal(input: {
  mentorId: string;
  amount: number;
  accountDetails: string;
  adminId: string;
  idempotencyKey: string;
}): Promise<ReserveResult> {
  // Idempotency pre-check (the UI also disables the button in-flight).
  const data = await db.read();
  const dup = (data.mentorWithdrawals ?? []).find((r) => r.payoutIdempotencyKey === input.idempotencyKey);
  if (dup) return { ok: true, requestId: dup.id };

  const r = await requestMentorWithdrawal({
    mentorId: input.mentorId,
    amount: input.amount,
    accountDetails: input.accountDetails,
  });
  if (!r.ok) {
    if (r.reason === 'WALLET_FROZEN') return { ok: false, reason: 'WALLET_FROZEN' };
    if (r.reason === 'INSUFFICIENT_FUNDS') return { ok: false, reason: 'INSUFFICIENT_FUNDS', balance: r.available };
    return { ok: false, reason: 'INSUFFICIENT_FUNDS' }; // BELOW_MINIMUM (guarded earlier)
  }

  await db.update((d) => {
    const w = (d.mentorWithdrawals ?? []).find((x) => x.id === r.request.id);
    if (!w) return;
    w.payoutSource = 'ADMIN_DIRECT';
    w.payoutCreatedByAdminId = input.adminId;
    w.payoutIdempotencyKey = input.idempotencyKey;
  });
  return { ok: true, requestId: r.request.id };
}
