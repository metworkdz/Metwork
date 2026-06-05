/**
 * Client-side mirror of the server deposit math (`src/server/bookings/pricing.ts`
 * → computeDeposit). DISPLAY ONLY — the server always recomputes the authoritative
 * deposit at intent + settlement time; this just lets the booking forms preview
 * the split without pulling server-only code into the client bundle.
 *
 * Keep this byte-for-byte in step with `computeDeposit` so the preview never
 * disagrees with what the client is actually charged.
 */
export type CashDepositType = 'FIXED' | 'PERCENT';

/**
 * Online deposit D for a CASH booking of total T.
 *   PERCENT → round(value/100 * T)
 *   FIXED   → min(value, T)
 * Returns null when not configured / invalid (so callers fall back gracefully).
 */
export function computeClientDeposit(
  total: number,
  type?: CashDepositType | null,
  value?: number | null,
): number | null {
  if (!Number.isFinite(total) || total <= 0) return null;
  if (!type || value == null || !Number.isFinite(value) || value <= 0) return null;

  let deposit: number;
  if (type === 'PERCENT') {
    if (value < 1 || value > 100) return null;
    deposit = Math.round((value / 100) * total);
  } else {
    deposit = Math.min(Math.round(value), total);
  }

  if (deposit <= 0) deposit = Math.min(1, total);
  if (deposit > total) deposit = total;
  if (deposit <= 0) return null;
  return deposit;
}
