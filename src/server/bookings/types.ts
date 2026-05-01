/**
 * Service result types for bookings. Kept separate so the route handler
 * can `switch` on the discriminator without needing the implementation.
 */
import type { BookingRecord, TransactionRecord, WalletRecord } from '@/server/db/store';

export type CreateSpaceBookingResult =
  | {
      ok: true;
      replayed: boolean;
      booking: BookingRecord;
      transaction: TransactionRecord;
      wallet: WalletRecord;
    }
  | { ok: false; reason: 'SPACE_NOT_FOUND' }
  | { ok: false; reason: 'UNIT_NOT_AVAILABLE'; available: ('HOUR' | 'DAY' | 'MONTH')[] }
  | { ok: false; reason: 'CAPACITY_EXCEEDED'; capacity: number }
  | { ok: false; reason: 'WALLET_FROZEN' }
  | { ok: false; reason: 'INSUFFICIENT_FUNDS'; balance: number; required: number };

/** Quote returned to the UI before the user confirms a booking. */
export interface BookingQuote {
  unitPrice: number;
  total: number;
  endsAt: string;
}

/* ───────── Programs ───────── */

export type ApplyToProgramResult =
  | {
      ok: true;
      replayed: boolean;
      booking: BookingRecord;
      /** null when the program was free (no wallet movement). */
      transaction: TransactionRecord | null;
      wallet: WalletRecord;
    }
  | { ok: false; reason: 'PROGRAM_NOT_FOUND' }
  | { ok: false; reason: 'DEADLINE_PASSED'; deadline: string }
  | { ok: false; reason: 'CAPACITY_EXCEEDED'; capacity: number; taken: number }
  | { ok: false; reason: 'ALREADY_APPLIED'; existingBookingId: string }
  | { ok: false; reason: 'WALLET_FROZEN' }
  | { ok: false; reason: 'INSUFFICIENT_FUNDS'; balance: number; required: number };

/* ───────── Events ───────── */

export type RegisterForEventResult =
  | {
      ok: true;
      replayed: boolean;
      booking: BookingRecord;
      transaction: TransactionRecord | null;
      wallet: WalletRecord;
    }
  | { ok: false; reason: 'EVENT_NOT_FOUND' }
  | { ok: false; reason: 'EVENT_PASSED'; eventDate: string }
  | { ok: false; reason: 'CAPACITY_EXCEEDED'; capacity: number; taken: number }
  | { ok: false; reason: 'ALREADY_REGISTERED'; existingBookingId: string }
  | { ok: false; reason: 'WALLET_FROZEN' }
  | { ok: false; reason: 'INSUFFICIENT_FUNDS'; balance: number; required: number };
