/**
 * Frontend consultant-portal service. Wraps the flag-gated /api/consultant/*
 * endpoints. The HttpOnly `metwork_consultant` cookie is same-origin, so it
 * rides along automatically.
 */
import { apiClient } from '@/lib/api-client';

export interface ConsultantMentor {
  id: string;
  fullName: string;
  position: string;
  email: string | null;
  consultationFee?: number;
  defaultMeetingMode?: 'ONLINE' | 'OFFLINE';
  defaultMeetingLink?: string | null;
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
  message: string;
  scheduledAt: string | null;
  durationMinutes: number | null;
  meetingMode: 'ONLINE' | 'OFFLINE' | null;
  meetingLink: string | null;
  amountCharged: number;
  completedAt: string | null;
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

export interface ConsultantEarnings {
  wallet: ConsultantWalletDto;
  transactions: ConsultantLedgerTxn[];
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

  updateProfile: (body: { defaultMeetingMode?: 'ONLINE' | 'OFFLINE'; defaultMeetingLink?: string | null }) =>
    apiClient.patch<{ mentor: ConsultantMentor }>('/consultant/profile', body),

  bookings: () => apiClient.get<{ items: ConsultantBooking[]; total: number }>('/consultant/bookings'),
  setBookingLink: (id: string, body: { mode: 'ONLINE' | 'OFFLINE'; link?: string | null }) =>
    apiClient.post<ConsultantBooking>(`/consultant/bookings/${encodeURIComponent(id)}/link`, body),
  completeBooking: (id: string) =>
    apiClient.post<{ id: string; status: string; released: number }>(
      `/consultant/bookings/${encodeURIComponent(id)}/complete`,
    ),

  earnings: () => apiClient.get<ConsultantEarnings>('/consultant/earnings'),
  withdrawals: () => apiClient.get<{ items: ConsultantWithdrawal[]; total: number }>('/consultant/withdrawals'),
  requestWithdrawal: (body: { amount: number; accountDetails: string }) =>
    apiClient.post<{ withdrawal: ConsultantWithdrawal }>('/consultant/withdrawals', body),
};
