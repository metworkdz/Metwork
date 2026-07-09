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
  /**
   * Desk / office unit to reserve (COWORKING desk name or PRIVATE_OFFICE unit).
   * When set, the server also writes per-day desk holds so the unit is blocked.
   */
  deskName?: string;
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
  /**
   * Fixed 50/50 split for CASH_DEPOSIT: pay exactly half online now, half in
   * cash on-site (bypasses the listing's configured deposit). Ignored for
   * ONLINE_FULL. Used by the logged-in space flow when no deposit is configured.
   */
  splitHalf?: boolean;
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

/**
 * Public-space "book before you sign up" selection carrier. A logged-out visitor
 * picks a date/time + payment option; we persist ONLY the selection (no price)
 * so it survives signup+OTP / login, then resume it once authenticated.
 */
export interface CreateSpaceBookingIntentInput {
  spaceId: string;
  unit: BookingUnit;
  startsAt: string;
  endsAt: string;
  paymentMode: 'ONLINE_FULL' | 'CASH_DEPOSIT';
  /** Fixed 50/50 split for CASH_DEPOSIT when the listing has no configured deposit. */
  splitHalf?: boolean;
}

export interface CreateSpaceBookingIntentResponse {
  id: string;
  expiresAt: string;
}

export interface ResumeBookingIntentResponse {
  /** Locale-prefixed path of the hosted-checkout pay page to navigate to. */
  payPath: string;
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

  /**
   * Persist a logged-out visitor's space selection before sending them to
   * signup/login. Returns the carrier id to thread through `?bookingIntent=`.
   */
  async createSpaceBookingIntent(
    input: CreateSpaceBookingIntentInput,
  ): Promise<CreateSpaceBookingIntentResponse> {
    return apiClient.post<CreateSpaceBookingIntentResponse>('/bookings/intent', input);
  },

  /**
   * Resume a carried selection once authenticated: the server re-validates
   * availability, prices the booking, and returns the pay-page path.
   */
  async resumeBookingIntent(id: string): Promise<ResumeBookingIntentResponse> {
    return apiClient.post<ResumeBookingIntentResponse>(
      `/bookings/intent/${encodeURIComponent(id)}/resume`,
      {},
    );
  },

  /**
   * Settle an APPROVED_UNPAID request-to-book reservation from the wallet.
   * `token` is the single-use credential from the approval email link.
   * Throws ApiClientError INSUFFICIENT_FUNDS with details.needsTopUp on a
   * short balance (no state change server-side).
   */
  async payRequestBooking(
    bookingId: string,
    token: string,
  ): Promise<{ booking: BookingDto; replayed: boolean; alreadyPaid: boolean }> {
    return apiClient.post<{ booking: BookingDto; replayed: boolean; alreadyPaid: boolean }>(
      `/bookings/${encodeURIComponent(bookingId)}/pay`,
      { token },
    );
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
