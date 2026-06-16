/**
 * Server-side schemas for booking endpoints.
 */
import { z } from 'zod';

/** Optional promo code — present on all booking endpoints */
const promoCodeField = z.string().min(1).max(50).optional();

/**
 * Payment method the client chooses at booking time.
 * - wallet / ONLINE  → debit wallet (status PENDING → CONFIRMED on payment).
 * - manual / CASH    → reserve only (status PENDING_PAYMENT).
 * - NETWORK_PASS     → free pass redeemed against the user's monthly allowance
 *                      (only valid for spaces enrolled in the Partner Program).
 * Accepts both legacy and new values; the upstream service handles the
 * branching on the resulting canonical value.
 */
const paymentMethodField = z
  .enum(['wallet', 'manual', 'ONLINE', 'CASH', 'NETWORK_PASS'])
  .transform((v) => {
    if (v === 'ONLINE') return 'wallet' as const;
    if (v === 'CASH') return 'manual' as const;
    return v as 'wallet' | 'manual' | 'NETWORK_PASS';
  })
  .default('wallet');

/**
 * Schema for space bookings — same as `paymentMethodField` above but
 * NETWORK_PASS is allowed only here (programs / events are not yet
 * redeemable with the Network Pass).
 */
const spacePaymentMethodField = paymentMethodField;

/** Stripped-down field for endpoints that don't accept NETWORK_PASS. */
const nonPassPaymentMethodField = z
  .enum(['wallet', 'manual', 'ONLINE', 'CASH'])
  .transform((v) => (v === 'ONLINE' ? 'wallet' : v === 'CASH' ? 'manual' : v) as 'wallet' | 'manual')
  .default('wallet');

export const createSpaceBookingSchema = z.object({
  spaceId: z.string().min(1),
  unit: z.enum(['HOUR', 'HALF_DAY', 'DAY', 'MONTH']),
  /** ISO 8601 datetime string — explicit booking start. */
  startsAt: z.string().datetime(),
  /** ISO 8601 datetime string — explicit booking end. Must be after startsAt. */
  endsAt: z.string().datetime(),
  /** Idempotency key — the same key always produces the same booking. */
  clientReference: z.string().min(8).max(128),
  /** Optional promotional code — discount applied before wallet debit. */
  promoCode: promoCodeField,
  paymentMethod: spacePaymentMethodField,
}).refine((d) => new Date(d.endsAt) > new Date(d.startsAt), {
  message: 'endsAt must be after startsAt',
  path: ['endsAt'],
});

export type CreateSpaceBookingInput = z.infer<typeof createSpaceBookingSchema>;

export const applyToProgramSchema = z.object({
  clientReference: z.string().min(8).max(128),
  promoCode: promoCodeField,
  paymentMethod: nonPassPaymentMethodField,
});
export type ApplyToProgramInput = z.infer<typeof applyToProgramSchema>;

export const registerForEventSchema = z.object({
  clientReference: z.string().min(8).max(128),
  promoCode: promoCodeField,
  paymentMethod: nonPassPaymentMethodField,
});
export type RegisterForEventInput = z.infer<typeof registerForEventSchema>;

/**
 * Card-settled booking intent (SPACE / PROGRAM / EVENT) — used by both guest
 * and registered clients who pay by card (CIB / Edahabia) instead of wallet.
 * The `paymentMode` chooses the surface:
 *   - ONLINE_FULL  → pay the whole total online now.
 *   - CASH_DEPOSIT → pay a deposit online now, balance in cash on-site.
 * No price is ever supplied by the client; the server recomputes T / D / C.
 */
const cardCustomerSchema = z.object({
  fullName: z.string().min(2).max(120),
  email: z.string().email().max(160),
  phone: z.string().min(6).max(40),
  idNumber: z.string().min(2).max(60).optional().nullable(),
});

export const createCardBookingSchema = z
  .object({
    target: z.discriminatedUnion('itemKind', [
      z.object({
        itemKind: z.literal('SPACE'),
        spaceId: z.string().min(1),
        unit: z.enum(['HOUR', 'HALF_DAY', 'DAY', 'MONTH']),
        startsAt: z.string().datetime(),
        endsAt: z.string().datetime(),
      }),
      z.object({ itemKind: z.literal('PROGRAM'), programId: z.string().min(1) }),
      z.object({ itemKind: z.literal('EVENT'), eventId: z.string().min(1) }),
    ]),
    paymentMode: z.enum(['ONLINE_FULL', 'CASH_DEPOSIT']),
    customer: cardCustomerSchema,
    clientReference: z.string().min(8).max(128),
    promoCode: promoCodeField,
    locale: z.enum(['en', 'fr', 'ar']).optional(),
  })
  .superRefine((d, ctx) => {
    if (
      d.target.itemKind === 'SPACE' &&
      new Date(d.target.endsAt) <= new Date(d.target.startsAt)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'endsAt must be after startsAt',
        path: ['target', 'endsAt'],
      });
    }
  });
export type CreateCardBookingApiInput = z.infer<typeof createCardBookingSchema>;
