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
  /** Consultant WhatsApp/contact phone (private — consultant-self DTO only). */
  phone?: string | null;
  /** Consultant's city (public). */
  city?: string | null;
  consultationFee?: number;
  defaultMeetingMode?: 'ONLINE' | 'OFFLINE';
  defaultMeetingLink?: string | null;
  /** In-person defaults (private). */
  defaultMeetingAddress?: string | null;
  defaultMeetingMapsLink?: string | null;
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
  meetingAddress?: string | null;
  meetingMapsLink?: string | null;
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

export interface ConsultantWithdrawal {
  id: string;
  amount: number;
  accountDetails: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  method?: 'bank_transfer' | 'ccp' | 'cheque' | null;
  adminNote?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Saved payout destination (bank RIB or CCP RIP — both 20 digits). */
export interface ConsultantPayoutAccount {
  accountType: 'bank' | 'ccp';
  accountNumber: string;
  holderName: string;
}

export const consultantService = {
  me: () => apiClient.get<ConsultantMe>('/consultant/me'),

  // ── Email → OTP sign-in (untrusted device / first sign-in) ──
  requestOtp: (email: string) =>
    apiClient.post<{ ok: true }>('/consultant/otp/request', { email }),
  verifyOtp: (email: string, code: string) =>
    apiClient.post<{ ok: true; pinSet: boolean }>('/consultant/otp/verify', { email, code }),

  logout: (forgetDevice?: boolean) =>
    apiClient.post<{ ok: true }>('/consultant/logout', { forgetDevice: Boolean(forgetDevice) }),

  updateProfile: (body: {
    defaultMeetingMode?: 'ONLINE' | 'OFFLINE';
    defaultMeetingLink?: string | null;
    defaultMeetingAddress?: string | null;
    defaultMeetingMapsLink?: string | null;
    phone?: string | null;
    city?: string | null;
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

  // ── First-time PIN creation (after OTP sign-in, session-guarded) ──
  setPin: (body: { pin: string; rememberDevice?: boolean }) =>
    apiClient.post<{ ok: true; deviceRemembered: boolean }>('/consultant/pin/set', body),

  // ── Trusted-device PIN unlock ──
  unlockState: () => apiClient.get<{ trusted: boolean }>('/consultant/pin/unlock'),
  unlockPin: (pin: string) =>
    apiClient.post<{ ok: true }>('/consultant/pin/unlock', { pin }),

  changePin: (body: { currentPin: string; newPin: string }) =>
    apiClient.patch<{ ok: true }>('/consultant/pin/change', body),

  bookings: () => apiClient.get<{ items: ConsultantBooking[]; total: number }>('/consultant/bookings'),
  setBookingLink: (
    id: string,
    body: { mode: 'ONLINE' | 'OFFLINE'; link?: string | null; address?: string | null; mapsLink?: string | null },
  ) =>
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
  requestWithdrawal: (body: { amount: number; method: 'bank_transfer' | 'ccp' | 'cheque' }) =>
    apiClient.post<{ withdrawal: ConsultantWithdrawal }>('/consultant/withdrawals', body),

  payoutAccount: () =>
    apiClient.get<{ payoutAccount: ConsultantPayoutAccount | null }>('/consultant/payout-account'),
  savePayoutAccount: (body: ConsultantPayoutAccount) =>
    apiClient.put<{ payoutAccount: ConsultantPayoutAccount }>('/consultant/payout-account', body),
};
