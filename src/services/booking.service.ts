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
  quantity: number;
  startsAt: string;
  /** Idempotency key. Generate one (e.g. crypto.randomUUID()) per booking attempt. */
  clientReference: string;
}

export interface ApplyOrRegisterInput {
  /** Idempotency key. Generate one per attempt. */
  clientReference: string;
}

export const bookingService = {
  async createSpaceBooking(input: CreateSpaceBookingInput): Promise<CreateSpaceBookingResponse> {
    return apiClient.post<CreateSpaceBookingResponse>('/bookings', input);
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
