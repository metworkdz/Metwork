/**
 * Frontend booking service.
 */
import { apiClient } from '@/lib/api-client';
import type {
  ApplyOrRegisterResponse,
  BookingDto,
  BookingUnit,
  CreateSpaceBookingResponse,
  ItemAttendanceStatus,
} from '@/types/booking';

export interface CreateSpaceBookingInput {
  spaceId: string;
  unit: BookingUnit;
  startsAt: string;
  endsAt: string;
  /** Idempotency key. Generate one (e.g. crypto.randomUUID()) per booking attempt. */
  clientReference: string;
  /** Optional promotional code — applied server-side before wallet debit. */
  promoCode?: string;
  /** Payment method. CASH = reserve without wallet debit (PENDING_PAYMENT). Default ONLINE. */
  paymentMethod?: 'ONLINE' | 'CASH';
}

export interface ApplyOrRegisterInput {
  /** Idempotency key. Generate one per attempt. */
  clientReference: string;
  /** Optional promotional code — applied server-side before wallet debit. */
  promoCode?: string;
  /** Payment method. CASH = reserve without wallet debit (PENDING_PAYMENT). Default ONLINE. */
  paymentMethod?: 'ONLINE' | 'CASH';
}

/**
 * Card-settled booking (CIB / Edahabia via hosted checkout) — for guests and
 * for registered clients paying a CASH deposit by card. The server recomputes
 * all amounts; the client never supplies a price.
 *   - ONLINE_FULL  → pay the whole total online now.
 *   - CASH_DEPOSIT → pay a deposit online now, balance in cash on-site.
 */
export type CardBookingTargetInput =
  | { itemKind: 'SPACE'; spaceId: string; unit: BookingUnit; startsAt: string; endsAt: string }
  | { itemKind: 'PROGRAM'; programId: string }
  | { itemKind: 'EVENT'; eventId: string };

export interface CreateCardBookingInput {
  target: CardBookingTargetInput;
  paymentMode: 'ONLINE_FULL' | 'CASH_DEPOSIT';
  customer: { fullName: string; email: string; phone: string; idNumber?: string | null };
  /** Idempotency key. Generate one per attempt. */
  clientReference: string;
  promoCode?: string;
  locale?: 'en' | 'fr' | 'ar';
}

export interface CreateCardBookingResponse {
  token: string;
  /** Locale-prefixed path of the hosted-checkout pay page to navigate to. */
  payPath: string;
  replayed: boolean;
}

export const bookingService = {
  async createSpaceBooking(input: CreateSpaceBookingInput): Promise<CreateSpaceBookingResponse> {
    return apiClient.post<CreateSpaceBookingResponse>('/bookings', input);
  },

  /**
   * Create a card-settled booking intent (guest or registered card-deposit).
   * Returns a pay token + the pay-page path to redirect the browser to.
   */
  async createCardBooking(input: CreateCardBookingInput): Promise<CreateCardBookingResponse> {
    return apiClient.post<CreateCardBookingResponse>('/bookings/card', input);
  },

  async applyToProgram(programId: string, input: ApplyOrRegisterInput): Promise<ApplyOrRegisterResponse> {
    return apiClient.post<ApplyOrRegisterResponse>(
      `/programs/${encodeURIComponent(programId)}/apply`,
      input,
    );
  },

  async getProgramStatus(programId: string): Promise<ItemAttendanceStatus> {
    return apiClient.get<ItemAttendanceStatus>(
      `/programs/${encodeURIComponent(programId)}/status`,
    );
  },

  async registerForEvent(eventId: string, input: ApplyOrRegisterInput): Promise<ApplyOrRegisterResponse> {
    return apiClient.post<ApplyOrRegisterResponse>(
      `/events/${encodeURIComponent(eventId)}/register`,
      input,
    );
  },

  async getEventStatus(eventId: string): Promise<ItemAttendanceStatus> {
    return apiClient.get<ItemAttendanceStatus>(
      `/events/${encodeURIComponent(eventId)}/status`,
    );
  },

  async listMine(): Promise<{ items: BookingDto[]; total: number }> {
    return apiClient.get<{ items: BookingDto[]; total: number }>('/bookings');
  },
};
