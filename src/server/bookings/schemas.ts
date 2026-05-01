/**
 * Server-side schemas for booking endpoints.
 */
import { z } from 'zod';

export const createSpaceBookingSchema = z.object({
  spaceId: z.string().min(1),
  unit: z.enum(['HOUR', 'DAY', 'MONTH']),
  /** Whole units. Hours: 1–24, days: 1–365, months: 1–24. */
  quantity: z.number().int().min(1).max(365),
  /** ISO 8601 datetime string. The server clamps to the start of the day for DAY/MONTH bookings. */
  startsAt: z.string().datetime(),
  /** Idempotency key — the same key always produces the same booking. */
  clientReference: z.string().min(8).max(128),
});

export type CreateSpaceBookingInput = z.infer<typeof createSpaceBookingSchema>;

export const applyToProgramSchema = z.object({
  clientReference: z.string().min(8).max(128),
});
export type ApplyToProgramInput = z.infer<typeof applyToProgramSchema>;

export const registerForEventSchema = z.object({
  clientReference: z.string().min(8).max(128),
});
export type RegisterForEventInput = z.infer<typeof registerForEventSchema>;
