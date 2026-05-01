/**
 * Client-facing wallet types. These are the DTOs exposed by the API and
 * consumed by `src/services/wallet.service.ts`.
 */
import type { Paginated } from './domain';

export type WalletStatus = 'ACTIVE' | 'FROZEN';

export interface Wallet {
  id: string;
  /** Integer DZD. */
  balance: number;
  currency: 'DZD';
  status: WalletStatus;
}

export type TransactionType =
  | 'TOP_UP'
  | 'PAYMENT'
  | 'REFUND'
  | 'ADJUSTMENT'
  | 'PAYOUT'
  | 'COMMISSION';

export type TransactionStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'REVERSED';

export interface Transaction {
  id: string;
  type: TransactionType;
  /** Signed integer DZD: positive = credit, negative = debit. */
  amount: number;
  balanceAfter: number;
  status: TransactionStatus;
  description: string;
  reference: string;
  provider: string;
  createdAt: string;
  completedAt: string | null;
}

export type TransactionPage = Paginated<Transaction>;

export interface InitTopUpResponse {
  topUpId: string;
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
  /** Hosted checkout URL when status is PENDING and the provider needs a redirect. */
  redirectUrl: string | null;
  /** New balance, only set when status is COMPLETED. */
  balance: number | null;
}

export interface TopUpStatusResponse {
  topUpId: string;
  status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'EXPIRED';
  amount: number;
  provider: string;
  redirectUrl: string | null;
  transactionId: string | null;
}
