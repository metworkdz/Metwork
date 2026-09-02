/**
 * Manual withdrawal flow — THE single service for creating, approving and
 * rejecting withdrawal requests across both money ledgers:
 *
 *   • user wallet   → WithdrawalRequestRecord + TransactionRecord hold
 *   • mentor ledger → MentorWithdrawalRecord  + MentorLedgerTxnRecord hold
 *     (kept deliberately separate — consultants are not platform users; see
 *     the mentor-ledger notes in store.ts)
 *
 * Money model (hold-at-request):
 *   create  → the amount immediately leaves the available balance into a
 *             PENDING escrow hold, so the same funds can't be requested twice.
 *             For bank/ccp the target's payout account is validated and
 *             SNAPSHOTTED onto the request — a later account edit can never
 *             redirect an in-flight withdrawal. Cheque needs no account.
 *   approve → the admin has moved the money externally (bank wire / CCP /
 *             cheque); the escrow hold settles to COMPLETED. IDEMPOTENT: only
 *             a PENDING request transitions — a retried/double-clicked
 *             approval replays as success without double-debiting or
 *             double-emailing.
 *   reject  → the hold is released back to the available balance.
 *
 * The approval email (localised en/fr/ar, method-aware) is fire-and-forget:
 * a notification failure never fails or rolls back the approval.
 */
import { randomUUID } from 'node:crypto';
import {
  db,
  type MentorWithdrawalRecord,
  type PayoutAccount,
  type TransactionRecord,
  type WithdrawalMethod,
  type WithdrawalRequestRecord,
} from '@/server/db/store';
import {
  requestMentorWithdrawal,
  resolveMentorWithdrawal,
} from '@/server/mentors/ledger';
import {
  sendWithdrawalApprovedEmail,
  sendWithdrawalProcessedEmail,
} from '@/server/notifications/mock';
import { getPlatformConfig, isMonthlyFlatActive } from '@/server/incubator/service';

/** Smallest withdrawal, server-enforced (mirrors the mentor-ledger floor). */
export const MIN_WITHDRAWAL = 500;

export type WithdrawalTargetType = 'user' | 'mentor';

export type AnyWithdrawalRequest = WithdrawalRequestRecord | MentorWithdrawalRecord;

/**
 * An Algerian bank RIB and an Algérie Poste CCP RIP are both exactly 20 digits
 * (spaces tolerated on input).
 */
export function isValidPayoutAccountNumber(accountNumber: string): boolean {
  return /^\d{20}$/.test(accountNumber.replace(/\s+/g, ''));
}

/** Normalise a payout account for storage/snapshot (number stripped to 20 digits). */
export function normalizePayoutAccount(a: PayoutAccount): PayoutAccount {
  return {
    accountType: a.accountType,
    accountNumber: a.accountNumber.replace(/\s+/g, ''),
    holderName: a.holderName.trim(),
  };
}

/** Mask an account number to its last 4 digits for display, e.g. `****6789`. */
export function maskAccountNumber(accountNumber: string): string {
  const digits = accountNumber.replace(/\s+/g, '');
  return digits.length >= 4 ? `****${digits.slice(-4)}` : '****';
}

/* ─────────────────────────── Payout account on file ─────────────────────────── */

export type SetPayoutAccountResult =
  | { ok: true; account: PayoutAccount }
  | { ok: false; reason: 'TARGET_NOT_FOUND' | 'INVALID_ACCOUNT_NUMBER' | 'INVALID_HOLDER_NAME' };

/** Register / replace a target's payout account (RIB or CCP RIP on file). */
export async function setPayoutAccount(input: {
  targetType: WithdrawalTargetType;
  targetId: string;
  account: PayoutAccount;
}): Promise<SetPayoutAccountResult> {
  const account = normalizePayoutAccount(input.account);
  if (!isValidPayoutAccountNumber(account.accountNumber)) {
    return { ok: false, reason: 'INVALID_ACCOUNT_NUMBER' };
  }
  if (account.holderName.length < 2) return { ok: false, reason: 'INVALID_HOLDER_NAME' };

  const found = await db.update<boolean>((d) => {
    const rec =
      input.targetType === 'user'
        ? d.users.find((u) => u.id === input.targetId)
        : (d.mentors ?? []).find((m) => m.id === input.targetId);
    if (!rec) return false;
    rec.payoutAccount = account;
    if ('updatedAt' in rec) rec.updatedAt = new Date().toISOString();
    return true;
  });

  if (!found) return { ok: false, reason: 'TARGET_NOT_FOUND' };
  return { ok: true, account };
}

/* ─────────────────────────── Create (hold at request) ─────────────────────────── */

export type CreateWithdrawalResult =
  | { ok: true; request: AnyWithdrawalRequest }
  | { ok: false; reason: 'INVALID_AMOUNT' }
  | { ok: false; reason: 'INVALID_ACCOUNT_DETAILS' }
  | { ok: false; reason: 'TARGET_NOT_FOUND' }
  | { ok: false; reason: 'NO_PAYOUT_ACCOUNT'; requiredType: 'bank' | 'ccp' }
  | { ok: false; reason: 'WALLET_FROZEN' }
  | { ok: false; reason: 'BELOW_MINIMUM'; minimum: number }
  | { ok: false; reason: 'INSUFFICIENT_FUNDS'; available: number; required: number }
  | { ok: false; reason: 'MIN_BALANCE'; balance: number; minBalance: number };

/**
 * Create a withdrawal request and place the escrow hold atomically.
 * bank_transfer/ccp require a saved payout account of the MATCHING type — it is
 * snapshotted onto the request. Cheque requires none (snapshot stays null).
 *
 * `method: null` = legacy request from a pre-method client: no account
 * validation/snapshot; the caller-provided free-text `legacyAccountDetails`
 * is stored instead (same hold path — there is only one).
 */
export async function createWithdrawalRequest(input: {
  targetType: WithdrawalTargetType;
  targetId: string;
  amount: number;
  method: WithdrawalMethod | null;
  /** Required when method is null (legacy free-text flow). */
  legacyAccountDetails?: string;
}): Promise<CreateWithdrawalResult> {
  const amount = Math.round(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, reason: 'INVALID_AMOUNT' };
  if (amount < MIN_WITHDRAWAL) return { ok: false, reason: 'BELOW_MINIMUM', minimum: MIN_WITHDRAWAL };

  // Resolve the target + destination snapshot OUTSIDE the critical section.
  const data = await db.read();
  const target =
    input.targetType === 'user'
      ? data.users.find((u) => u.id === input.targetId)
      : (data.mentors ?? []).find((m) => m.id === input.targetId);
  if (!target) return { ok: false, reason: 'TARGET_NOT_FOUND' };

  let snapshot: PayoutAccount | null = null;
  if (input.method === 'bank_transfer' || input.method === 'ccp') {
    const requiredType = input.method === 'bank_transfer' ? 'bank' : 'ccp';
    const onFile = target.payoutAccount ?? null;
    if (
      !onFile ||
      onFile.accountType !== requiredType ||
      !isValidPayoutAccountNumber(onFile.accountNumber)
    ) {
      return { ok: false, reason: 'NO_PAYOUT_ACCOUNT', requiredType };
    }
    snapshot = normalizePayoutAccount(onFile);
  }

  const holderName =
    snapshot?.holderName ??
    ('fullName' in target && target.fullName ? target.fullName : '');
  // Free-text mirror of the destination (legacy admin surfaces render it).
  const accountDetails =
    input.method === null
      ? (input.legacyAccountDetails ?? '').trim()
      : input.method === 'bank_transfer' && snapshot
        ? `Virement bancaire — RIB ${snapshot.accountNumber} — ${snapshot.holderName}`
        : input.method === 'ccp' && snapshot
          ? `CCP — RIP ${snapshot.accountNumber} — ${snapshot.holderName}`
          : `Chèque — ${holderName || 'à retirer sur place'}`;
  if (input.method === null && accountDetails.length < 5) {
    return { ok: false, reason: 'INVALID_ACCOUNT_DETAILS' };
  }

  if (input.targetType === 'mentor') {
    const r = await requestMentorWithdrawal({
      mentorId: input.targetId,
      amount,
      accountDetails,
      method: input.method,
      destinationAccountSnapshot: snapshot,
    });
    if (!r.ok) {
      if (r.reason === 'WALLET_FROZEN') return { ok: false, reason: 'WALLET_FROZEN' };
      if (r.reason === 'BELOW_MINIMUM') return { ok: false, reason: 'BELOW_MINIMUM', minimum: r.minimum };
      return { ok: false, reason: 'INSUFFICIENT_FUNDS', available: r.available, required: r.required };
    }
    return { ok: true, request: r.request };
  }

  // User wallet — atomic: balance checks + hold + request in one update.
  // Monthly-Pro incubator owners must keep one month's subscription fee in the
  // wallet so the billing cron can always renew (fee fetched outside the
  // critical section; the plan check runs inside it).
  const monthlyFee = (await getPlatformConfig()).flatMonthlyPrice;

  return db.update<CreateWithdrawalResult>((d) => {
    const wallet = d.wallets.find((w) => w.userId === input.targetId);
    if (!wallet) {
      return { ok: false, reason: 'INSUFFICIENT_FUNDS', available: 0, required: amount };
    }
    if (wallet.status === 'FROZEN') return { ok: false, reason: 'WALLET_FROZEN' };
    if (wallet.balance < amount) {
      return { ok: false, reason: 'INSUFFICIENT_FUNDS', available: wallet.balance, required: amount };
    }

    const ownedIncubator = (d.incubators ?? []).find(
      (inc) => inc.managerId === input.targetId || ('email' in target && inc.email === target.email),
    );
    if (ownedIncubator && isMonthlyFlatActive(ownedIncubator)) {
      if (wallet.balance - amount < monthlyFee) {
        return { ok: false, reason: 'MIN_BALANCE', balance: wallet.balance, minBalance: monthlyFee };
      }
    }

    const now = new Date().toISOString();
    wallet.balance -= amount;
    wallet.updatedAt = now;

    const holdTx: TransactionRecord = {
      id: randomUUID(),
      walletId: wallet.id,
      userId: input.targetId,
      type: 'PAYOUT',
      amount: -amount,
      balanceAfter: wallet.balance,
      status: 'PENDING',
      description: `Withdrawal request — ${amount.toLocaleString()} DZD`,
      reference: `withdrawal-hold-${randomUUID().slice(0, 8)}`,
      provider: 'internal',
      providerTxnId: null,
      metadata: { accountDetails, method: input.method },
      createdAt: now,
      completedAt: null,
    };
    d.transactions.push(holdTx);

    const request: WithdrawalRequestRecord = {
      id: randomUUID(),
      userId: input.targetId,
      amount,
      accountDetails,
      status: 'PENDING',
      holdTransactionId: holdTx.id,
      method: input.method,
      destinationAccountSnapshot: snapshot,
      createdAt: now,
      updatedAt: now,
    };
    d.withdrawalRequests.push(request);

    return { ok: true, request };
  });
}

/* ─────────────────────────── Approve (idempotent) ─────────────────────────── */

export type ApproveWithdrawalResult =
  | { ok: true; request: AnyWithdrawalRequest; replayed: boolean }
  | { ok: false; reason: 'NOT_FOUND' | 'ALREADY_RESOLVED' };

/**
 * Finalize the debit of the held amount. Idempotent: an already-APPROVED
 * request replays as success (no re-settle, no second email); an already-
 * REJECTED one conflicts. The approval email is fired AFTER the money
 * transition commits and never blocks or reverts it.
 */
export async function approveWithdrawal(input: {
  targetType: WithdrawalTargetType;
  requestId: string;
  adminId: string;
  adminNote?: string | null;
  /** Optional proof of transfer (from /api/upload); may also be attached earlier. */
  receiptUrl?: string | null;
}): Promise<ApproveWithdrawalResult> {
  let request: AnyWithdrawalRequest;

  if (input.targetType === 'mentor') {
    const r = await resolveMentorWithdrawal({
      id: input.requestId,
      status: 'APPROVED',
      adminNote: input.adminNote ?? null,
      processedByAdminId: input.adminId,
      receiptUrl: input.receiptUrl ?? null,
    });
    if (!r.ok) {
      if (r.reason === 'ALREADY_RESOLVED' && r.request?.status === 'APPROVED') {
        return { ok: true, request: r.request, replayed: true };
      }
      return { ok: false, reason: r.reason === 'NOT_FOUND' ? 'NOT_FOUND' : 'ALREADY_RESOLVED' };
    }
    request = r.request;
  } else {
    type Claim =
      | { kind: 'OK'; request: WithdrawalRequestRecord }
      | { kind: 'REPLAY'; request: WithdrawalRequestRecord }
      | { kind: 'NOT_FOUND' }
      | { kind: 'RESOLVED' };
    const claim = await db.update<Claim>((d) => {
      const r = d.withdrawalRequests.find((x) => x.id === input.requestId);
      if (!r) return { kind: 'NOT_FOUND' };
      if (r.status === 'APPROVED') return { kind: 'REPLAY', request: r };
      if (r.status !== 'PENDING') return { kind: 'RESOLVED' };

      const now = new Date().toISOString();
      r.status = 'APPROVED';
      r.approvedAt = now;
      r.processedByAdminId = input.adminId;
      if (input.adminNote !== undefined) r.adminNote = input.adminNote;
      if (input.receiptUrl != null) r.receiptUrl = input.receiptUrl;
      const hold = d.transactions.find((t) => t.id === r.holdTransactionId);
      if (hold) {
        hold.status = 'COMPLETED';
        hold.completedAt = now;
      }
      r.updatedAt = now;
      return { kind: 'OK', request: r };
    });

    if (claim.kind === 'NOT_FOUND') return { ok: false, reason: 'NOT_FOUND' };
    if (claim.kind === 'RESOLVED') return { ok: false, reason: 'ALREADY_RESOLVED' };
    if (claim.kind === 'REPLAY') return { ok: true, request: claim.request, replayed: true };
    request = claim.request;
  }

  // Money is settled — notify (fire-and-forget, never blocks the approval).
  void notifyWithdrawalApproved(input.targetType, request);

  return { ok: true, request, replayed: false };
}

/** Resolve recipient + locale and send the localized approval email. */
async function notifyWithdrawalApproved(
  targetType: WithdrawalTargetType,
  request: AnyWithdrawalRequest,
): Promise<void> {
  try {
    const data = await db.read();
    let email: string | null | undefined;
    let name = '';
    let lang: 'en' | 'fr' | 'ar' = 'fr';

    if (targetType === 'user') {
      const user = data.users.find((u) => u.id === (request as WithdrawalRequestRecord).userId);
      email = user?.email;
      name = user?.fullName ?? user?.email ?? '';
      lang = user?.locale ?? 'fr';
    } else {
      const mentor = (data.mentors ?? []).find(
        (m) => m.id === (request as MentorWithdrawalRecord).mentorId,
      );
      email = mentor?.email;
      name = mentor?.fullName ?? '';
      // Mentors have no stored locale — fall back to the platform default (fr).
    }

    if (!email) return;
    // Awaited: an unawaited send is dropped when the lambda freezes.
    await sendWithdrawalApprovedEmail(
      email,
      {
        name,
        amount: request.amount,
        method: request.method ?? null,
        adminNote: request.adminNote ?? null,
      },
      lang,
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[withdrawals] approval email failed (approval unaffected):', err);
  }
}

/* ─────────────────────────── Reject (release the hold) ─────────────────────────── */

export type RejectWithdrawalResult =
  | { ok: true; request: AnyWithdrawalRequest; replayed: boolean }
  | { ok: false; reason: 'NOT_FOUND' | 'ALREADY_RESOLVED' | 'WALLET_FROZEN' };

/**
 * Release the hold back to the available balance. Idempotent like approve: an
 * already-REJECTED request replays as success (no double refund).
 * WALLET_FROZEN blocks the refund — the admin must unfreeze first rather than
 * silently losing the held money.
 */
export async function rejectWithdrawal(input: {
  targetType: WithdrawalTargetType;
  requestId: string;
  adminId: string;
  reason?: string | null;
}): Promise<RejectWithdrawalResult> {
  let request: AnyWithdrawalRequest;

  if (input.targetType === 'mentor') {
    const r = await resolveMentorWithdrawal({
      id: input.requestId,
      status: 'REJECTED',
      adminNote: input.reason ?? null,
      processedByAdminId: input.adminId,
    });
    if (!r.ok) {
      if (r.reason === 'ALREADY_RESOLVED' && r.request?.status === 'REJECTED') {
        return { ok: true, request: r.request, replayed: true };
      }
      if (r.reason === 'WALLET_FROZEN') return { ok: false, reason: 'WALLET_FROZEN' };
      return { ok: false, reason: r.reason === 'NOT_FOUND' ? 'NOT_FOUND' : 'ALREADY_RESOLVED' };
    }
    request = r.request;
  } else {
    type Claim =
      | { kind: 'OK'; request: WithdrawalRequestRecord }
      | { kind: 'REPLAY'; request: WithdrawalRequestRecord }
      | { kind: 'NOT_FOUND' }
      | { kind: 'RESOLVED' }
      | { kind: 'FROZEN' };
    const claim = await db.update<Claim>((d) => {
      const r = d.withdrawalRequests.find((x) => x.id === input.requestId);
      if (!r) return { kind: 'NOT_FOUND' };
      if (r.status === 'REJECTED') return { kind: 'REPLAY', request: r };
      if (r.status !== 'PENDING') return { kind: 'RESOLVED' };

      // A frozen wallet can't take the refund and the funds would be silently
      // lost — force the admin to unfreeze first.
      const wallet = d.wallets.find((w) => w.userId === r.userId);
      if (wallet && wallet.status === 'FROZEN') return { kind: 'FROZEN' };

      const now = new Date().toISOString();
      if (wallet) {
        wallet.balance += r.amount;
        wallet.updatedAt = now;

        const refundTx: TransactionRecord = {
          id: randomUUID(),
          walletId: wallet.id,
          userId: r.userId,
          type: 'REFUND',
          amount: r.amount,
          balanceAfter: wallet.balance,
          status: 'COMPLETED',
          description: 'Withdrawal rejected — refund',
          reference: `withdrawal-refund-${r.id.slice(0, 8)}`,
          provider: 'internal',
          providerTxnId: null,
          metadata: { withdrawalRequestId: r.id, adminNote: input.reason ?? null },
          createdAt: now,
          completedAt: now,
        };
        d.transactions.push(refundTx);
        r.refundTransactionId = refundTx.id;

        const holdTx = d.transactions.find((t) => t.id === r.holdTransactionId);
        if (holdTx) {
          holdTx.status = 'REVERSED';
          holdTx.completedAt = now;
        }
      }

      r.status = 'REJECTED';
      r.processedByAdminId = input.adminId;
      r.adminNote = input.reason ?? null;
      r.updatedAt = now;
      return { kind: 'OK', request: r };
    });

    if (claim.kind === 'NOT_FOUND') return { ok: false, reason: 'NOT_FOUND' };
    if (claim.kind === 'RESOLVED') return { ok: false, reason: 'ALREADY_RESOLVED' };
    if (claim.kind === 'FROZEN') return { ok: false, reason: 'WALLET_FROZEN' };
    if (claim.kind === 'REPLAY') return { ok: true, request: claim.request, replayed: true };
    request = claim.request;
  }

  void notifyWithdrawalRejected(input.targetType, request);

  return { ok: true, request, replayed: false };
}

/** Rejection notice (funds returned) — reuses the existing processed-email. */
async function notifyWithdrawalRejected(
  targetType: WithdrawalTargetType,
  request: AnyWithdrawalRequest,
): Promise<void> {
  try {
    const data = await db.read();
    const email =
      targetType === 'user'
        ? data.users.find((u) => u.id === (request as WithdrawalRequestRecord).userId)?.email
        : (data.mentors ?? []).find((m) => m.id === (request as MentorWithdrawalRecord).mentorId)
            ?.email;
    const name =
      targetType === 'user'
        ? data.users.find((u) => u.id === (request as WithdrawalRequestRecord).userId)?.fullName
        : (data.mentors ?? []).find((m) => m.id === (request as MentorWithdrawalRecord).mentorId)
            ?.fullName;
    if (!email) return;
    // Awaited: an unawaited send is dropped when the lambda freezes.
    await sendWithdrawalProcessedEmail(email, {
      userName: name ?? email,
      amount: request.amount,
      status: 'REJECTED',
      adminNote: request.adminNote ?? undefined,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[withdrawals] rejection email failed (rejection unaffected):', err);
  }
}

/* ─────────────────────────── Receipt attachment ─────────────────────────── */

export type AttachReceiptResult =
  | { ok: true; request: AnyWithdrawalRequest }
  | { ok: false; reason: 'NOT_FOUND' };

/**
 * Save a transfer receipt/screenshot reference (uploaded via the existing
 * /api/upload) onto the request. Allowed before OR after approval.
 */
export async function attachReceipt(input: {
  targetType: WithdrawalTargetType;
  requestId: string;
  receiptUrl: string;
}): Promise<AttachReceiptResult> {
  const request = await db.update<AnyWithdrawalRequest | null>((d) => {
    const r =
      input.targetType === 'user'
        ? d.withdrawalRequests.find((x) => x.id === input.requestId)
        : (d.mentorWithdrawals ?? []).find((x) => x.id === input.requestId);
    if (!r) return null;
    r.receiptUrl = input.receiptUrl;
    r.updatedAt = new Date().toISOString();
    return r;
  });

  if (!request) return { ok: false, reason: 'NOT_FOUND' };
  return { ok: true, request };
}
