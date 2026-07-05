'use client';

/**
 * Admin Payments page — the withdrawal-request queue. Withdrawals are settled
 * MANUALLY (bank wire / CCP / cheque outside the platform): the admin moves
 * the money, then approves the request here (or rejects to refund the hold).
 */
import { WithdrawalRequestsTab } from './withdrawal-requests-tab';

export function PaymentsDashboard() {
  return <WithdrawalRequestsTab />;
}
