/** Shared client types + helpers for the admin Payments dashboard. */
import type { PayoutDispatchStatus, WithdrawalStatus } from '@/server/db/store';

export type PayoutTargetType = 'user' | 'mentor';

export interface BankAccountMasked {
  title: string;
  firstname: string;
  lastname: string;
  address: string;
  ribMasked: string;
}

export interface PayableTarget {
  id: string;
  type: PayoutTargetType;
  name: string;
  role: string;
  balance: number;
  bankAccount: BankAccountMasked | null;
}

/** A withdrawal request row, normalised across the user + mentor endpoints. */
export interface RequestRow {
  id: string;
  targetType: PayoutTargetType;
  targetId: string;
  name: string;
  amount: number;
  balance: number;
  status: WithdrawalStatus;
  payoutStatus?: PayoutDispatchStatus | null;
  payoutFailureReason?: string | null;
  bankAccount: BankAccountMasked | null;
  createdAt: string;
}

/** Effective, UI-facing payout state used by the colour-coded pills. */
export type PayoutPill = 'requested' | 'processing' | 'sent' | 'failed' | 'rejected';

export function payoutPillOf(r: { status: WithdrawalStatus; payoutStatus?: PayoutDispatchStatus | null }): PayoutPill {
  if (r.status === 'REJECTED') return 'rejected';
  if (r.status === 'APPROVED') return 'sent';
  if (r.payoutStatus === 'PROCESSING') return 'processing';
  if (r.payoutStatus === 'FAILED') return 'failed';
  return 'requested';
}

export const formatAmount = (n: number) => `${n.toLocaleString()} DZD`;
export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

/**
 * Bottom-sheet on mobile, centred dialog on desktop — pure Tailwind, no JS
 * detection. Overrides the centred DialogContent base via `max-sm:` utilities.
 */
export const MODAL_CONTENT_CLASS =
  'max-sm:top-auto max-sm:bottom-0 max-sm:translate-y-0 max-sm:w-full max-sm:max-w-none ' +
  'max-sm:rounded-b-none max-sm:rounded-t-2xl max-sm:border-x-0 max-sm:border-b-0';
