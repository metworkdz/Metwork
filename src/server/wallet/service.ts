/**
 * Wallet service. All money-moving operations (top-up settlement,
 * charge, refund) happen inside a single `db.update` critical section
 * so balance reads and writes can't interleave.
 */
import { randomUUID } from 'node:crypto';
import {
  db,
  type TopUpIntentRecord,
  type TransactionRecord,
  type WalletRecord,
} from '@/server/db/store';
import { getActiveProvider } from '@/server/payments/registry';
import type { InitTopUpInput } from '@/server/payments/provider';
import { clientEnvVars } from '@/lib/env';
import {
  MAX_TOPUP,
  MIN_TOPUP,
  type ChargeResult,
  type ConfirmTopUpResult,
} from './types';

/* ─────────────────────────── Wallet lifecycle ─────────────────────────── */

function newWallet(userId: string): WalletRecord {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    userId,
    balance: 0,
    currency: 'DZD',
    status: 'ACTIVE',
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Get the user's wallet, creating it on first access. Idempotent —
 * concurrent calls for a brand-new user only create one wallet because
 * the DB write queue serializes mutators.
 */
export async function getOrCreateWallet(userId: string): Promise<WalletRecord> {
  return db.update<WalletRecord>((d) => {
    const existing = d.wallets.find((w) => w.userId === userId);
    if (existing) return existing;
    const wallet = newWallet(userId);
    d.wallets.push(wallet);
    return wallet;
  });
}

export async function getWallet(userId: string): Promise<WalletRecord | null> {
  const data = await db.read();
  return data.wallets.find((w) => w.userId === userId) ?? null;
}

/* ─────────────────────────── Transaction history ─────────────────────────── */

export interface ListTransactionsInput {
  userId: string;
  page?: number;
  pageSize?: number;
  type?: TransactionRecord['type'];
}

export async function listTransactions(input: ListTransactionsInput) {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 20));
  const data = await db.read();
  const all = data.transactions
    .filter((t) => t.userId === input.userId)
    .filter((t) => (input.type ? t.type === input.type : true))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const total = all.length;
  const start = (page - 1) * pageSize;
  return {
    items: all.slice(start, start + pageSize),
    total,
    page,
    pageSize,
    hasMore: start + pageSize < total,
  };
}

/* ─────────────────────────── Charge (debit) ─────────────────────────── */

export interface ChargeInput {
  userId: string;
  amount: number;
  description: string;
  /** Idempotency key — must be unique per logical purchase. */
  reference: string;
  metadata?: Record<string, unknown>;
}

/**
 * Atomically debit the user's wallet. Idempotent on `reference` — replaying
 * the same charge returns the original transaction without double-spending.
 */
export async function chargeWallet(input: ChargeInput): Promise<ChargeResult> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    return {
      ok: false,
      reason: 'INSUFFICIENT_FUNDS',
      balance: 0,
      required: input.amount,
    };
  }

  return db.update<ChargeResult>((d) => {
    let wallet = d.wallets.find((w) => w.userId === input.userId);
    if (!wallet) {
      wallet = newWallet(input.userId);
      d.wallets.push(wallet);
    }
    if (wallet.status === 'FROZEN') {
      return { ok: false, reason: 'WALLET_FROZEN' };
    }

    // Idempotency: if a non-failed transaction with this reference already
    // exists for the wallet, return it instead of charging again.
    const existing = d.transactions.find(
      (t) =>
        t.walletId === wallet!.id &&
        t.reference === input.reference &&
        t.status !== 'FAILED',
    );
    if (existing) {
      return { ok: true, replayed: true, transaction: existing, wallet };
    }

    if (wallet.balance < input.amount) {
      return {
        ok: false,
        reason: 'INSUFFICIENT_FUNDS',
        balance: wallet.balance,
        required: input.amount,
      };
    }

    const now = new Date().toISOString();
    wallet.balance -= input.amount;
    wallet.updatedAt = now;

    const tx: TransactionRecord = {
      id: randomUUID(),
      walletId: wallet.id,
      userId: input.userId,
      type: 'PAYMENT',
      amount: -input.amount,
      balanceAfter: wallet.balance,
      status: 'COMPLETED',
      description: input.description,
      reference: input.reference,
      provider: 'internal',
      providerTxnId: null,
      metadata: input.metadata ?? {},
      createdAt: now,
      completedAt: now,
    };
    d.transactions.push(tx);
    return { ok: true, replayed: false, transaction: tx, wallet };
  });
}

/* ─────────────────────────── Top-up flow ─────────────────────────── */

export interface InitiateTopUpInput {
  userId: string;
  amount: number;
  customer: { fullName: string; email: string; phone: string };
  /** Where the user lands after the hosted checkout (success or failure). */
  returnUrl?: string;
}

export type InitiateTopUpResult =
  | {
      ok: true;
      topUp: TopUpIntentRecord;
      /** Set when settlement happened synchronously. */
      transaction: TransactionRecord | null;
      wallet: WalletRecord;
    }
  | { ok: false; reason: 'AMOUNT_OUT_OF_RANGE'; min: number; max: number }
  | { ok: false; reason: 'WALLET_FROZEN' }
  | { ok: false; reason: 'PROVIDER_FAILED'; message: string };

export async function initiateTopUp(input: InitiateTopUpInput): Promise<InitiateTopUpResult> {
  if (
    !Number.isInteger(input.amount) ||
    input.amount < MIN_TOPUP ||
    input.amount > MAX_TOPUP
  ) {
    return { ok: false, reason: 'AMOUNT_OUT_OF_RANGE', min: MIN_TOPUP, max: MAX_TOPUP };
  }

  const wallet = await getOrCreateWallet(input.userId);
  if (wallet.status === 'FROZEN') return { ok: false, reason: 'WALLET_FROZEN' };

  const provider = getActiveProvider();
  const topUpId = randomUUID();
  const base = clientEnvVars.NEXT_PUBLIC_APP_URL.replace(/\/$/, '');
  const initInput: InitTopUpInput = {
    topUpId,
    userId: input.userId,
    amount: input.amount,
    // Default return URL embeds the topUpId so the success page can verify
    // without a separate lookup. Callers may override for custom flows.
    returnUrl: input.returnUrl ?? `${base}/en/payment/success?topUpId=${topUpId}`,
    webhookUrl: `${base}/api/webhooks/payments/${provider.code}`,
    customer: input.customer,
  };

  let providerResult;
  try {
    providerResult = await provider.initTopUp(initInput);
  } catch (err) {
    return {
      ok: false,
      reason: 'PROVIDER_FAILED',
      message: err instanceof Error ? err.message : 'Unknown provider error',
    };
  }

  // Persist the intent. If the provider settled synchronously we also
  // settle the wallet here, in the same critical section.
  const settled = await db.update<{
    topUp: TopUpIntentRecord;
    wallet: WalletRecord;
    transaction: TransactionRecord | null;
  }>((d) => {
    const now = new Date().toISOString();
    const intent: TopUpIntentRecord = {
      id: topUpId,
      userId: input.userId,
      walletId: wallet.id,
      amount: input.amount,
      provider: provider.code,
      providerRef: providerResult.providerRef,
      status: providerResult.status === 'COMPLETED' ? 'COMPLETED' : 'PENDING',
      redirectUrl: providerResult.redirectUrl,
      transactionId: null,
      createdAt: now,
      updatedAt: now,
    };
    d.topUpIntents.push(intent);

    const w = d.wallets.find((x) => x.id === wallet.id)!;
    let transaction: TransactionRecord | null = null;
    if (providerResult.status === 'COMPLETED') {
      w.balance += input.amount;
      w.updatedAt = now;
      transaction = {
        id: randomUUID(),
        walletId: w.id,
        userId: input.userId,
        type: 'TOP_UP',
        amount: input.amount,
        balanceAfter: w.balance,
        status: 'COMPLETED',
        description: `Top-up via ${provider.code}`,
        reference: topUpId,
        provider: provider.code,
        providerTxnId: providerResult.providerRef,
        metadata: {},
        createdAt: now,
        completedAt: now,
      };
      d.transactions.push(transaction);
      intent.transactionId = transaction.id;
    } else if (providerResult.status === 'PENDING') {
      // Record a PENDING ledger entry too so the user sees the in-flight
      // top-up in their history. It will be flipped to COMPLETED (or
      // discarded) once the webhook arrives.
      transaction = {
        id: randomUUID(),
        walletId: w.id,
        userId: input.userId,
        type: 'TOP_UP',
        amount: input.amount,
        balanceAfter: w.balance, // balance unchanged until settlement
        status: 'PENDING',
        description: `Top-up via ${provider.code} (pending)`,
        reference: topUpId,
        provider: provider.code,
        providerTxnId: providerResult.providerRef,
        metadata: {},
        createdAt: now,
        completedAt: null,
      };
      d.transactions.push(transaction);
      intent.transactionId = transaction.id;
    }

    return { topUp: intent, wallet: w, transaction };
  });

  if (providerResult.status === 'FAILED') {
    return {
      ok: false,
      reason: 'PROVIDER_FAILED',
      message: 'Provider rejected the top-up',
    };
  }

  return { ok: true, ...settled };
}

export async function getTopUp(topUpId: string): Promise<TopUpIntentRecord | null> {
  const data = await db.read();
  return data.topUpIntents.find((t) => t.id === topUpId) ?? null;
}

/**
 * Idempotent settlement of a top-up. Called from the webhook route once
 * the provider's signature is verified.
 */
export async function confirmTopUp(input: {
  topUpId: string;
  providerRef: string;
  status: 'COMPLETED' | 'FAILED';
}): Promise<ConfirmTopUpResult> {
  return db.update<ConfirmTopUpResult>((d) => {
    const intent = d.topUpIntents.find((t) => t.id === input.topUpId);
    if (!intent) return { ok: false, reason: 'INTENT_NOT_FOUND' };

    // Already terminal → idempotent replay.
    if (intent.status === 'COMPLETED' || intent.status === 'FAILED') {
      const tx = intent.transactionId
        ? d.transactions.find((t) => t.id === intent.transactionId) ?? null
        : null;
      const wallet = d.wallets.find((w) => w.id === intent.walletId) ?? null;
      return {
        ok: true,
        replayed: true,
        transaction: tx,
        wallet,
        finalStatus: intent.status,
      };
    }

    const now = new Date().toISOString();
    const wallet = d.wallets.find((w) => w.id === intent.walletId);
    if (!wallet) {
      // Shouldn't happen, but fail safe.
      intent.status = 'FAILED';
      intent.updatedAt = now;
      return { ok: true, replayed: false, transaction: null, wallet: null, finalStatus: 'FAILED' };
    }

    // Find the pre-existing PENDING ledger entry, if any.
    const pending = d.transactions.find(
      (t) =>
        t.walletId === wallet.id &&
        t.reference === intent.id &&
        t.status === 'PENDING',
    );

    if (input.status === 'FAILED') {
      intent.status = 'FAILED';
      intent.providerRef = input.providerRef;
      intent.updatedAt = now;
      if (pending) {
        pending.status = 'FAILED';
        pending.completedAt = now;
      }
      return {
        ok: true,
        replayed: false,
        transaction: pending ?? null,
        wallet,
        finalStatus: 'FAILED',
      };
    }

    // COMPLETED path: credit the wallet and flip the ledger entry.
    wallet.balance += intent.amount;
    wallet.updatedAt = now;
    intent.status = 'COMPLETED';
    intent.providerRef = input.providerRef;
    intent.updatedAt = now;

    let transaction: TransactionRecord;
    if (pending) {
      pending.status = 'COMPLETED';
      pending.completedAt = now;
      pending.balanceAfter = wallet.balance;
      pending.providerTxnId = input.providerRef;
      pending.description = `Top-up via ${intent.provider}`;
      transaction = pending;
    } else {
      transaction = {
        id: randomUUID(),
        walletId: wallet.id,
        userId: intent.userId,
        type: 'TOP_UP',
        amount: intent.amount,
        balanceAfter: wallet.balance,
        status: 'COMPLETED',
        description: `Top-up via ${intent.provider}`,
        reference: intent.id,
        provider: intent.provider,
        providerTxnId: input.providerRef,
        metadata: {},
        createdAt: now,
        completedAt: now,
      };
      d.transactions.push(transaction);
      intent.transactionId = transaction.id;
    }

    return {
      ok: true,
      replayed: false,
      transaction,
      wallet,
      finalStatus: 'COMPLETED',
    };
  });
}
