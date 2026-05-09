/**
 * Server-side schemas for booking endpoints.
 */
import { z } from 'zod';

/** Optional promo code — present on all booking endpoints */
const promoCodeField = z.string().min(1).max(50).optional();

/**
 * Payment method the client chooses at booking time.
 * ONLINE = debit wallet; CASH = reserve only (PENDING_PAYMENT status).
 */
const paymentMethodField = z.enum(['ONLINE', 'CASH']).default('ONLINE');

export const createSpaceBookingSchema = z.object({
  spaceId: z.string().min(1),
  unit: z.enum(['HOUR', 'DAY', 'MONTH']),
  /** ISO 8601 datetime string — explicit booking start. */
  startsAt: z.string().datetime(),
  /** ISO 8601 datetime string — explicit booking end. Must be after startsAt. */
  endsAt: z.string().datetime(),
  /** Idempotency key — the same key always produces the same booking. */
  clientReference: z.string().min(8).max(128),
  /** Optional promotional code — discount applied before wallet debit. */
  promoCode: promoCodeField,
  paymentMethod: paymentMethodField,
}).refine((d) => new Date(d.endsAt) > new Date(d.startsAt), {
  message: 'endsAt must be after startsAt',
  path: ['endsAt'],
});

export type CreateSpaceBookingInput = z.infer<typeof createSpaceBookingSchema>;

export const applyToProgramSchema = z.object({
  clientReference: z.string().min(8).max(128),
  promoCode: promoCodeField,
  paymentMethod: paymentMethodField,
});
export type ApplyToProgramInput = z.infer<typeof applyToProgramSchema>;

export const registerForEventSchema = z.object({
  clientReference: z.string().min(8).max(128),
  promoCode: promoCodeField,
  paymentMethod: paymentMethodField,
});
export type RegisterForEventInput = z.infer<typeof registerForEventSchema>;
