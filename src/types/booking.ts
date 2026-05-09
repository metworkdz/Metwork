/**
 * Client-facing booking DTO. Returned by `POST /api/bookings` and
 * `GET /api/bookings/me`.
 */
import type { Wallet, Transaction } from './wallet';
import type { PaymentMethod } from './domain';

export type BookingItemKind = 'SPACE' | 'PROGRAM' | 'EVENT';
export type BookingUnit = 'HOUR' | 'DAY' | 'MONTH';
export type BookingDtoStatus = 'PENDING' | 'PENDING_PAYMENT' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED' | 'REFUNDED';

export interface BookingDto {
  id: string;
  itemKind: BookingItemKind;
  itemId: string;
  itemName: string;
  vendorName: string;
  city: string;
  unit: BookingUnit;
  quantity: number;
  startsAt: string;
  endsAt: string;
  totalAmount: number;
  status: BookingDtoStatus;
  clientReference: string;
  transactionId: string | null;
  /** null for legacy bookings and free items. */
  paymentMethod: 'wallet' | 'manual' | null;
  createdAt: string;
}

export interface CreateSpaceBookingResponse {
  booking: BookingDto;
  transaction: Transaction;
  wallet: Wallet;
  /** True when the same clientReference returned the original booking. */
  replayed: boolean;
}

/**
 * Returned by program apply / event register. The wallet transaction is
 * null when the item was free (no zero-DZD ledger row).
 */
export interface ApplyOrRegisterResponse {
  booking: BookingDto;
  transaction: Transaction | null;
  wallet: Wallet;
  replayed: boolean;
}

export interface ItemAttendanceStatus {
  capacity: number;
  taken: number;
  /** Set on programs only — events use `eventPassed`. */
  deadline?: string;
  deadlinePassed?: boolean;
  /** Set on events only. */
  eventDate?: string;
  eventPassed?: boolean;
  mine: {
    bookingId: string;
    status: BookingDtoStatus;
    createdAt: string;
  } | null;
}
