/**
 * Result types for the wallet service. Surface to callers (route handlers,
 * future booking flow) — everything in here is safe to JSON-serialize.
 */
import type { TransactionRecord, WalletRecord } from '@/server/db/store';

export const MIN_TOPUP = 100; // 100 DZD
export const MAX_TOPUP = 1_000_000; // 1,000,000 DZD per single top-up
export const MIN_PAYMENT = 1;

export type ChargeFailure =
  | { ok: false; reason: 'INSUFFICIENT_FUNDS'; balance: number; required: number }
  | { ok: false; reason: 'WALLET_FROZEN' }
  | { ok: false; reason: 'WALLET_NOT_FOUND' };

export type ChargeSuccess = {
  ok: true;
  /** True when an existing transaction with the same `reference` was returned (idempotent replay). */
  replayed: boolean;
  transaction: TransactionRecord;
  wallet: WalletRecord;
};

export type ChargeResult = ChargeSuccess | ChargeFailure;

export type ConfirmTopUpResult =
  | {
      ok: true;
      replayed: boolean;
      transaction: TransactionRecord | null;
      wallet: WalletRecord | null;
      finalStatus: 'COMPLETED' | 'FAILED';
    }
  | { ok: false; reason: 'INTENT_NOT_FOUND' };
