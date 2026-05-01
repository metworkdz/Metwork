/**
 * Server-side request schemas for wallet endpoints.
 */
import { z } from 'zod';
import { MAX_TOPUP, MIN_PAYMENT, MIN_TOPUP } from './types';

const positiveIntDzd = (min: number, max: number) =>
  z
    .number()
    .int({ message: 'amountMustBeInteger' })
    .min(min, { message: 'amountTooLow' })
    .max(max, { message: 'amountTooHigh' });

export const initTopUpSchema = z.object({
  amount: positiveIntDzd(MIN_TOPUP, MAX_TOPUP),
  /** Optional override for the post-checkout redirect. */
  returnUrl: z.string().url().optional(),
});
export type InitTopUpRequest = z.infer<typeof initTopUpSchema>;

export const chargeWalletSchema = z.object({
  amount: positiveIntDzd(MIN_PAYMENT, Number.MAX_SAFE_INTEGER),
  description: z.string().min(1).max(200),
  /** Idempotency key — frontend must generate one per logical purchase. */
  reference: z.string().min(8).max(128),
  metadata: z.record(z.unknown()).optional(),
});
export type ChargeWalletRequest = z.infer<typeof chargeWalletSchema>;
