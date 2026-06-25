/**
 * Booking-intent carriers for the public-space "book before you sign up" flow.
 *
 * A guest picks a date/time + payment option on a public space page and is sent
 * to signup/login. We persist ONLY that selection here (no price, no seat) so it
 * survives the full signup+OTP — or login — round trip reliably, then resume it
 * once the visitor is authenticated. The authoritative card-booking intent (with
 * server-recomputed price + a binding availability re-check) is created at resume
 * time by `createCardBookingIntent`; this module never touches money.
 *
 * Records are short-lived (1h) and swept on every write so abandoned selections
 * can't accumulate.
 */
import { randomUUID } from 'node:crypto';
import {
  db,
  type BookingIntentRecord,
  type BookingPaymentMode,
  type BookingUnit,
} from '@/server/db/store';

/** Intents live for 1 hour — long enough to finish signup + OTP, short enough to sweep. */
export const BOOKING_INTENT_TTL_MS = 60 * 60 * 1000;

export interface CreateBookingIntentInput {
  spaceId: string;
  unit: BookingUnit;
  startsAt: string;
  endsAt: string;
  paymentMode: BookingPaymentMode;
  splitHalf?: boolean;
}

/** Persist a guest's selection and return the carrier record (sweeps expired first). */
export async function createBookingIntent(
  input: CreateBookingIntentInput,
): Promise<BookingIntentRecord> {
  const now = new Date();
  const record: BookingIntentRecord = {
    id: randomUUID(),
    spaceId: input.spaceId,
    unit: input.unit,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    paymentMode: input.paymentMode,
    splitHalf: input.splitHalf ?? false,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + BOOKING_INTENT_TTL_MS).toISOString(),
  };

  await db.update((d) => {
    const cutoff = Date.now();
    d.bookingIntents = (d.bookingIntents ?? []).filter(
      (i) => new Date(i.expiresAt).getTime() > cutoff,
    );
    d.bookingIntents.push(record);
  });

  return record;
}

/** Read a still-valid (non-expired) intent, or null. */
export async function getValidBookingIntent(
  id: string,
): Promise<BookingIntentRecord | null> {
  const data = await db.read();
  const intent = (data.bookingIntents ?? []).find((i) => i.id === id);
  if (!intent) return null;
  if (new Date(intent.expiresAt).getTime() <= Date.now()) return null;
  return intent;
}

/** Remove an intent once it has been resumed (idempotent — missing id is a no-op). */
export async function consumeBookingIntent(id: string): Promise<void> {
  await db.update((d) => {
    d.bookingIntents = (d.bookingIntents ?? []).filter((i) => i.id !== id);
  });
}
