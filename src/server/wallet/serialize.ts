/**
 * Server → client serialization for wallet primitives. Keeps
 * provider-internal fields (like raw metadata) off the wire when needed.
 */
import type { TransactionRecord, WalletRecord } from '@/server/db/store';
import type { Transaction, Wallet } from '@/types/wallet';

export function toWalletDto(w: WalletRecord): Wallet {
  return {
    id: w.id,
    balance: w.balance,
    currency: w.currency,
    status: w.status,
  };
}

export function toTransactionDto(t: TransactionRecord): Transaction {
  return {
    id: t.id,
    type: t.type,
    amount: t.amount,
    balanceAfter: t.balanceAfter,
    status: t.status,
    description: t.description,
    reference: t.reference,
    provider: t.provider,
    createdAt: t.createdAt,
    completedAt: t.completedAt,
  };
}
