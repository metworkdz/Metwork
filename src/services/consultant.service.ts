/**
 * Frontend consultant-portal service. Wraps the flag-gated /api/consultant/*
 * endpoints. The HttpOnly `metwork_consultant` cookie is same-origin, so it
 * rides along automatically.
 */
import { apiClient } from '@/lib/api-client';
import type { WeeklyAvailabilityDay } from '@/types/mentor';

export interface ConsultantMentor {
  id: string;
  fullName: string;
  position: string;
  email: string | null;
  consultationFee?: number;
  defaultMeetingMode?: 'ONLINE' | 'OFFLINE';
  defaultMeetingLink?: string | null;
  // Profile (self-editable)
  bio?: string | null;
  topics?: string[];
  /** Display-only 30/60-min prices (do not affect the live charge). */
  ratePer30?: number | null;
  ratePer60?: number | null;
  freeIntroEnabled?: boolean | null;
  // Availability (self-editable)
  weeklyAvailability?: WeeklyAvailabilityDay[];
  blockedDates?: string[];
  availabilityTimezone?: string;
  minNoticeHours?: number | null;
  bufferMinutes?: number | null;
}

export interface ConsultantWalletDto {
  pendingBalance: number;
  availableBalance: number;
  currency: 'DZD';
  status: 'ACTIVE' | 'FROZEN';
}

export interface ConsultantMe {
  mentor: ConsultantMentor;
  wallet: ConsultantWalletDto;
}

export type ConsultantBookingStatus =
  | 'PENDING_PAYMENT' | 'AWAITING_LINK' | 'READY' | 'COMPLETED' | 'CANCELLED';

export interface ConsultantBooking {
  id: string;
  status: ConsultantBookingStatus;
  userName: string;
  /** Client contact details — rendered only to a valid PIN/device session. */
  userEmail: string;
  userPhone: string;
  message: string;
  scheduledAt: string | null;
  durationMinutes: number | null;
  meetingMode: 'ONLINE' | 'OFFLINE' | null;
  meetingLink: string | null;
  amountCharged: number;
  completedAt: string | null;
  /** 'guest' | 'registered' — consultant cancel/refund is members-only. */
  source?: 'guest' | 'registered';
  consultationDate?: string | null;
  consultationTime?: string | null;
  rescheduleCount?: number;
  createdAt: string;
}

export interface ConsultantLedgerTxn {
  id: string;
  type: 'EARNING' | 'COMMISSION' | 'RELEASE' | 'REVERSAL' | 'PAYOUT';
  amount: number;
  bucket: 'PENDING' | 'AVAILABLE';
  status: string;
  description: string;
  bookingId: string | null;
  createdAt: string;
}

/** Display-only earnings summary mirroring the admin mentor-revenue page. */
export interface ConsultantEarningsSummary {
  consultations: number;
  gross: number;
  commission: number;
  net: number;
}

export interface ConsultantEarnings {
  wallet: ConsultantWalletDto;
  summary: ConsultantEarningsSummary;
  transactions: ConsultantLedgerTxn[];
}

/** Durable-token + PIN sign-in state, used to pick the set/enter PIN screen. */
export interface ConsultantPinInfo {
  valid: boolean;
  pinSet: boolean;
  deviceRemembered?: boolean;
}

export interface ConsultantWithdrawal {
  id: string;
  amount: number;
  accountDetails: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  adminNote?: string | null;
  createdAt: string;
  updatedAt: string;
}

export const consultantService = {
  me: () => apiClient.get<ConsultantMe>('/consultant/me'),
  requestLink: (email: string, locale?: string) =>
    apiClient.post<{ ok: true }>('/consultant/request-link', { email, locale }),
  logout: () => apiClient.post<{ ok: true }>('/consultant/logout'),

  updateProfile: (body: {
    defaultMeetingMode?: 'ONLINE' | 'OFFLINE';
    defaultMeetingLink?: string | null;
    bio?: string | null;
    topics?: string[];
    ratePer30?: number | null;
    ratePer60?: number | null;
    freeIntroEnabled?: boolean | null;
  }) => apiClient.patch<{ mentor: ConsultantMentor }>('/consultant/profile', body),

  updateAvailability: (body: {
    weeklyAvailability: WeeklyAvailabilityDay[];
    blockedDates: string[];
    availabilityTimezone?: string;
    minNoticeHours?: number | null;
    bufferMinutes?: number | null;
  }) => apiClient.patch<{ mentor: ConsultantMentor }>('/consultant/availability', body),

  // Durable-token + PIN sign-in (parallel to the email magic link).
  pinInfo: (token: string) =>
    apiClient.get<ConsultantPinInfo>(`/consultant/pin?token=${encodeURIComponent(token)}`),
  pinSubmit: (body: { token: string; pin?: string; rememberDevice?: boolean }) =>
    apiClient.post<{ ok: true; pinJustSet: boolean; deviceRemembered: boolean }>('/consultant/pin', body),
  changePin: (body: { currentPin: string; newPin: string }) =>
    apiClient.patch<{ ok: true }>('/consultant/pin/change', body),

  bookings: () => apiClient.get<{ items: ConsultantBooking[]; total: number }>('/consultant/bookings'),
  setBookingLink: (id: string, body: { mode: 'ONLINE' | 'OFFLINE'; link?: string | null }) =>
    apiClient.post<ConsultantBooking>(`/consultant/bookings/${encodeURIComponent(id)}/link`, body),
  completeBooking: (id: string) =>
    apiClient.post<{ id: string; status: string; released: number }>(
      `/consultant/bookings/${encodeURIComponent(id)}/complete`,
    ),
  rescheduleBooking: (id: string, body: { date: string; time: string }) =>
    apiClient.post<{ id: string; status: string; scheduledAt: string | null; rescheduleCount: number }>(
      `/consultant/bookings/${encodeURIComponent(id)}/reschedule`,
      body,
    ),
  cancelBooking: (id: string, body?: { reason?: string }) =>
    apiClient.post<{ id: string; status: string; refundedAmount: number }>(
      `/consultant/bookings/${encodeURIComponent(id)}/cancel`,
      body ?? {},
    ),

  earnings: () => apiClient.get<ConsultantEarnings>('/consultant/earnings'),
  withdrawals: () => apiClient.get<{ items: ConsultantWithdrawal[]; total: number }>('/consultant/withdrawals'),
  requestWithdrawal: (body: { amount: number; accountDetails: string }) =>
    apiClient.post<{ withdrawal: ConsultantWithdrawal }>('/consultant/withdrawals', body),
};
