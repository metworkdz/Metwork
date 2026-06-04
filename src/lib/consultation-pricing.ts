/**
 * Consultation duration options + price helper. Single source of truth shared
 * by the booking dialog and the public mentor profile so the two never drift.
 *
 * Pricing model: `consultationFee` is the mentor's per-hour rate (DZD); the
 * price for a session is pro-rated by its duration.
 */
export interface DurationOption {
  value: number;
  label: string;
}

export const DURATION_OPTIONS: DurationOption[] = [
  { value: 30,  label: '30 min' },
  { value: 60,  label: '1 hour' },
  { value: 90,  label: '1 h 30' },
  { value: 120, label: '2 hours' },
  { value: 150, label: '2 h 30' },
  { value: 180, label: '3 hours' },
];

/** Compute price from hourly rate and duration. Returns 0 if the fee is free. */
export function computePrice(feePerHour: number, durationMinutes: number): number {
  if (!feePerHour || feePerHour <= 0) return 0;
  return Math.round((durationMinutes / 60) * feePerHour);
}
