/**
 * Client-side helpers for the payout-account + withdraw flow, shared by the
 * user wallet form and the consultant portal. Mirrors (UX only — the server
 * re-validates in src/server/withdrawals/service.ts) PROMPT 1's confirmed
 * rule: bank RIB and CCP RIP are both exactly 20 digits.
 */
import type { PayoutAccount, WithdrawalMethod } from '@/server/db/store';

export type { PayoutAccount, WithdrawalMethod };

export const ACCOUNT_NUMBER_DIGITS = 20;

/** 20 digits exactly, spaces tolerated on input. */
export function isValidAccountNumber(value: string): boolean {
  return new RegExp(`^\\d{${ACCOUNT_NUMBER_DIGITS}}$`).test(value.replace(/\s+/g, ''));
}

/** The transfer method a saved account type maps to. */
export function methodForAccountType(type: PayoutAccount['accountType']): WithdrawalMethod {
  return type === 'bank' ? 'bank_transfer' : 'ccp';
}

/** The account type a bank/ccp method requires (cheque needs none). */
export function accountTypeForMethod(method: WithdrawalMethod): PayoutAccount['accountType'] | null {
  return method === 'bank_transfer' ? 'bank' : method === 'ccp' ? 'ccp' : null;
}

/**
 * Bottom-sheet on mobile, centred dialog on desktop — pure Tailwind, no JS
 * detection. Overrides the centred DialogContent base via `max-sm:` utilities.
 */
export const SHEET_CONTENT_CLASS =
  'max-sm:top-auto max-sm:bottom-0 max-sm:translate-y-0 max-sm:w-full max-sm:max-w-none ' +
  'max-sm:rounded-b-none max-sm:rounded-t-2xl max-sm:border-x-0 max-sm:border-b-0';
