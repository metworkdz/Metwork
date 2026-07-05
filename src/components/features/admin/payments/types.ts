/** Shared client types + helpers for the admin Payments (withdrawals) page. */
import type { PayoutAccount, WithdrawalMethod, WithdrawalStatus } from '@/server/db/store';

export type PayoutTargetType = 'user' | 'mentor';

/** A withdrawal request row, normalised across the user + mentor endpoints. */
export interface RequestRow {
  id: string;
  targetType: PayoutTargetType;
  targetId: string;
  name: string;
  amount: number;
  balance: number;
  status: WithdrawalStatus;
  method?: WithdrawalMethod | null;
  destinationAccountSnapshot?: PayoutAccount | null;
  accountDetails: string;
  receiptUrl?: string | null;
  createdAt: string;
}

/** UI-facing state for the colour-coded status pills. */
export type StatusPillKind = 'requested' | 'approved' | 'rejected';

export function statusPillOf(r: { status: WithdrawalStatus }): StatusPillKind {
  if (r.status === 'REJECTED') return 'rejected';
  if (r.status === 'APPROVED') return 'approved';
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
