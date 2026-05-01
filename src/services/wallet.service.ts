/**
 * Frontend wallet service. UI components import from here, never from
 * `apiClient` directly — keeps the API surface narrow and lets us swap
 * transports (REST, tRPC, server actions) without touching components.
 */
import { apiClient } from '@/lib/api-client';
import type {
  InitTopUpResponse,
  TopUpStatusResponse,
  Transaction,
  TransactionPage,
  TransactionType,
  Wallet,
} from '@/types/wallet';

interface ListTransactionsParams {
  page?: number;
  pageSize?: number;
  type?: TransactionType;
}

export interface InitTopUpInput {
  /** Integer DZD. */
  amount: number;
  /** Override the post-checkout redirect; defaults to the wallet page. */
  returnUrl?: string;
}

export interface ChargeWalletInput {
  /** Integer DZD. */
  amount: number;
  description: string;
  /** Idempotency key — generate one per logical purchase. */
  reference: string;
  metadata?: Record<string, unknown>;
}

export interface ChargeWalletResponse {
  transaction: Transaction;
  wallet: Wallet;
  /** True when an existing transaction was returned (idempotent replay). */
  replayed: boolean;
}

export const walletService = {
  /** Get the current user's wallet. Creates it on first access. */
  async getMyWallet(): Promise<Wallet> {
    return apiClient.get<Wallet>('/wallet/me');
  },

  async listTransactions(params: ListTransactionsParams = {}): Promise<TransactionPage> {
    const query = new URLSearchParams();
    if (params.page) query.set('page', String(params.page));
    if (params.pageSize) query.set('pageSize', String(params.pageSize));
    if (params.type) query.set('type', params.type);
    const suffix = query.toString();
    return apiClient.get<TransactionPage>(
      `/wallet/transactions${suffix ? `?${suffix}` : ''}`,
    );
  },

  /** Initiate a top-up via the active payment provider. */
  async initiateTopUp(input: InitTopUpInput): Promise<InitTopUpResponse> {
    return apiClient.post<InitTopUpResponse>('/wallet/topup', input);
  },

  /** Poll a previously-initiated top-up. Used while waiting for an async webhook. */
  async getTopUp(topUpId: string): Promise<TopUpStatusResponse> {
    return apiClient.get<TopUpStatusResponse>(`/wallet/topup/${encodeURIComponent(topUpId)}`);
  },

  /**
   * Create a SlickPay (or active provider) transfer and return the
   * hosted-checkout URL. The wallet is credited only after the user
   * returns to /payment/success and the status endpoint confirms it.
   */
  async createPayment(input: { amount: number }): Promise<{
    topUpId: string;
    paymentUrl: string | null;
    status: string;
  }> {
    return apiClient.post('/payments/create', input);
  },

  /**
   * Debit the wallet for an internal platform purchase. Idempotent on
   * `reference` — the same reference replayed returns the original txn.
   */
  async charge(input: ChargeWalletInput): Promise<ChargeWalletResponse> {
    return apiClient.post<ChargeWalletResponse>('/wallet/payments', input);
  },
};
