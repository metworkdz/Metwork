/**
 * Frontend consultant-portal service. Wraps the flag-gated /api/consultant/*
 * endpoints. The HttpOnly `metwork_consultant` cookie is same-origin, so it
 * rides along automatically.
 */
import { apiClient } from '@/lib/api-client';
import type { WeeklyAvailabilityDay } from '@/types/mentor';
import type { Space } from '@/types/domain';

/**
 * Channel that actually delivered a consultant OTP. Returned by signup so the
 * confirmation copy can name the real destination. The login route
 * deliberately does NOT return it (it would leak account existence).
 */
export type OtpDeliveryChannel = 'whatsapp' | 'sms' | 'email';

/**
 * A bookable space as served to the consultant portal — the public `Space`
 * plus the host's phone, so the consultant can call instead of reserving.
 */
export type ConsultantSpace = Space & { contactPhone: string | null };

/** A space reservation made by the consultant (always cash / pay-on-site). */
export interface ConsultantSpaceBooking {
  id: string;
  status: string;
  itemName: string;
  vendorName: string;
  city: string;
  unit: 'HOUR' | 'HALF_DAY' | 'DAY' | 'MONTH';
  quantity: number;
  startsAt: string;
  endsAt: string;
  totalAmount: number;
  createdAt: string;
}

/** Shape of GET /api/spaces/:id/availability (public, canonical). */
export interface SpaceAvailabilityResponse {
  spaceId: string;
  from: string;
  to: string;
  capacity: number;
  workingDays: number[];
  openingTime: string;
  closingTime: string;
  intervals: { start: string; end: string; kind: 'BOOKING' | 'BLOCK'; allDay: boolean }[];
}

export interface ConsultantMentor {
  id: string;
  fullName: string;
  position: string;
  /** Avatar URL (self-uploadable from the portal). */
  imageUrl?: string;
  /** Public profile slug — powers /mentors/{slug}. Absent on pre-slug records (fall back to id). */
  slug?: string;
  email: string | null;
  /** Consultant WhatsApp/contact phone (private — consultant-self DTO only). */
  phone?: string | null;
  /** True once the phone was SMS-verified (private). Absent ⇒ not verified. */
  phoneVerified?: boolean;
  /** Consultant's city (public). */
  city?: string | null;
  /**
   * Full legal domicile + national ID — PRIVATE, consultant-self DTO only.
   * Contract identity; not the in-person meeting address.
   */
  address?: string | null;
  idNumber?: string | null;
  /** Consultation domain code (see `src/config/consultation-fields.ts`). */
  field?: string | null;
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
  // Self-signup approval gate (absent ⇒ APPROVED for legacy mentors)
  approvalStatus?: 'PENDING' | 'APPROVED' | 'REJECTED';
  approvalRejectionReason?: string | null;
  cvUrl?: string | null;
  /** Record origin. Absent ⇒ 'ADMIN' (legacy admin-added mentor). */
  source?: 'ADMIN' | 'SELF';
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
  /** 'auto' = Zoom auto-generated at settlement; 'manual' = consultant/admin supplied; 'offline' = in-person. */
  meetingSource?: 'auto' | 'manual' | 'offline' | null;
  /** Zoom host start URL — signs the consultant in as host. Only set when meetingSource === 'auto'. */
  zoomStartUrl?: string | null;
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

/** A consultant-owned program (same ProgramRecord incubators use). */
export interface ConsultantProgram {
  id: string;
  title: string;
  description: string;
  type: 'INCUBATION' | 'ACCELERATION' | 'TRAINING' | 'BOOTCAMP' | 'WORKSHOP' | 'WEBINAR';
  city: string;
  imageUrl: string | null;
  imageUrls?: string[];
  price: number;
  onlinePrice?: number | null;
  cashPrice?: number | null;
  acceptedPaymentMethods: ('ONLINE' | 'CASH')[];
  cashDepositType?: 'FIXED' | 'PERCENT';
  cashDepositValue?: number;
  seatsTotal: number;
  seatsTaken: number;
  deadline: string;
  startDate: string;
  endDate: string;
  slug?: string | null;
  hostName: string;
  isActive: boolean;
}

export interface ConsultantRegistration {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  status: 'CONFIRMED' | 'WAITLISTED' | 'CANCELLED';
  answers: Array<{ fieldId: string; value: string | string[] }>;
  createdAt: string;
}

export interface ConsultantFormField {
  id: string;
  label: string;
  type: 'SHORT_TEXT' | 'LONG_TEXT' | 'DROPDOWN' | 'MULTIPLE_CHOICE' | 'CHECKBOX' | 'PHONE' | 'EMAIL' | 'URL';
  options: string[] | null;
  required: boolean;
  order: number;
}

export interface ConsultantProgramInput {
  title: string;
  description: string;
  type: ConsultantProgram['type'];
  city: string;
  imageUrl?: string | null;
  imageUrls?: string[];
  price: number;
  onlinePrice?: number | null;
  cashPrice?: number | null;
  acceptedPaymentMethods: ('ONLINE' | 'CASH')[];
  cashDepositType?: 'FIXED' | 'PERCENT' | null;
  cashDepositValue?: number | null;
  seatsTotal: number;
  deadline: string;
  startDate: string;
  endDate: string;
}

/**
 * A consultant contract as the consultant sees it. Mirrors the server DTO in
 * `src/server/consultant-contracts/dto.ts` — deliberately narrower than the
 * stored record: no OTP counters, no audit trail.
 */
export interface ConsultantContract {
  id: string;
  status: 'DRAFT' | 'PENDING_SIGNATURE' | 'SIGNED' | 'VOIDED';
  contentSnapshot: string;
  /** Frozen at send-time, 0–1. Read-only everywhere in the UI. */
  commissionRate: number;
  payoutMethod: 'BANK_TRANSFER' | 'CCP' | 'CHEQUE';
  payoutDetails: string | null;
  signerPhoneSnapshot: string;
  sentAt: string | null;
  signedAt: string | null;
  /** True while a lockout blocks further signing attempts. */
  locked: boolean;
  /** Short-lived signed link; only present once signed. */
  pdfUrl: string | null;
}

export const consultantService = {
  me: () => apiClient.get<ConsultantMe>('/consultant/me'),

  // ── Self-signup (public) — creates a PENDING account + sends a sign-in OTP ──
  signup: (body: {
    fullName: string;
    position: string;
    email: string;
    phone: string;
    city?: string | null;
    field?: string | null;
    /** Data-processing consent (Law 18-07) — must be true; server enforces it too. */
    acceptPrivacy: boolean;
  }) => apiClient.post<{ ok: true; channel: OtpDeliveryChannel | null }>('/consultant/signup', body),

  // ── Email → OTP sign-in (untrusted device / first sign-in) ──
  requestOtp: (email: string) =>
    apiClient.post<{ ok: true }>('/consultant/otp/request', { email }),
  verifyOtp: (email: string, code: string, rememberDevice = false) =>
    apiClient.post<{ ok: true; pinSet: boolean; phoneVerified: boolean; emailVerified: boolean }>(
      '/consultant/otp/verify',
      { email, code, rememberDevice },
    ),

  // ── Phone verification via WhatsApp (default) / SMS OTP (session-guarded) ──
  requestPhoneOtp: (channel: 'whatsapp' | 'sms' = 'whatsapp') =>
    apiClient.post<{ ok: true; channel: 'whatsapp' | 'sms' }>('/consultant/phone/request', { channel }),
  verifyPhoneOtp: (code: string) =>
    apiClient.post<{ ok: true }>('/consultant/phone/verify', { code }),

  logout: (forgetDevice?: boolean) =>
    apiClient.post<{ ok: true }>('/consultant/logout', { forgetDevice: Boolean(forgetDevice) }),

  updateProfile: (body: {
    defaultMeetingMode?: 'ONLINE' | 'OFFLINE';
    defaultMeetingLink?: string | null;
    defaultMeetingAddress?: string | null;
    defaultMeetingMapsLink?: string | null;
    phone?: string | null;
    city?: string | null;
    /** Contract identity — full legal domicile + national ID. */
    address?: string | null;
    idNumber?: string | null;
    bio?: string | null;
    topics?: string[];
    /** Live per-hour rate (DZD) — the canonical fee the charge engine reads. */
    consultationFee?: number;
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

  // ── Spaces (reserve a room for an in-person consultation) ──
  /** Cash-accepting spaces only — a consultant settles with the space on site. */
  spaces: () => apiClient.get<{ spaces: ConsultantSpace[]; cities: string[] }>('/consultant/spaces'),
  spaceBookings: () =>
    apiClient.get<{ items: ConsultantSpaceBooking[] }>('/consultant/space-bookings'),
  createSpaceBooking: (body: {
    spaceId: string;
    unit: 'HOUR' | 'HALF_DAY' | 'DAY' | 'MONTH';
    startsAt: string;
    endsAt: string;
    clientReference: string;
    deskName?: string;
  }) =>
    apiClient.post<{ booking: ConsultantSpaceBooking; replayed: boolean }>(
      '/consultant/space-bookings',
      body,
    ),
  /** Cancel one of the consultant's own space reservations (no money involved). */
  cancelSpaceBooking: (id: string) =>
    apiClient.post<{ id: string; status: string }>(
      `/consultant/space-bookings/${encodeURIComponent(id)}/cancel`,
    ),
  /** Canonical unavailability feed for a space — same source the write gate uses. */
  spaceAvailability: (spaceId: string, from: string, to: string) =>
    apiClient.get<SpaceAvailabilityResponse>(
      `/spaces/${encodeURIComponent(spaceId)}/availability?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    ),

  /* ── Programs (trainings / workshops / webinars) ─────────────────────── */

  programs: () =>
    apiClient.get<{ items: ConsultantProgram[]; total: number }>('/consultant/programs'),
  createProgram: (body: ConsultantProgramInput) =>
    apiClient.post<ConsultantProgram>('/consultant/programs', body),
  updateProgram: (id: string, body: Partial<ConsultantProgramInput> & { status?: 'DRAFT' | 'PUBLISHED' | 'CLOSED' }) =>
    apiClient.patch<{ program: ConsultantProgram }>(
      `/consultant/programs/${encodeURIComponent(id)}`,
      body,
    ),
  deleteProgram: (id: string) =>
    apiClient.delete<{ ok: true }>(`/consultant/programs/${encodeURIComponent(id)}`),

  /** Registrants for one of the consultant's programs. */
  programRegistrations: (entityId: string) =>
    apiClient.get<{ registrations: ConsultantRegistration[]; total: number }>(
      `/consultant/registrations?entityId=${encodeURIComponent(entityId)}`,
    ),
  cancelProgramRegistration: (id: string) =>
    apiClient.patch<{ registration: ConsultantRegistration }>('/consultant/registrations', { id }),

  /** Custom registration-form fields for one of the consultant's programs. */
  programFormFields: (entityId: string) =>
    apiClient.get<{ fields: ConsultantFormField[] }>(
      `/consultant/registration-form?entityId=${encodeURIComponent(entityId)}`,
    ),
  saveProgramFormFields: (entityId: string, fields: Array<Omit<ConsultantFormField, 'id'>>) =>
    apiClient.post<{ fields: ConsultantFormField[] }>('/consultant/registration-form', {
      entityId,
      fields,
    }),

  // ── Consultant contracts (e-signature) ──
  contracts: () => apiClient.get<{ contracts: ConsultantContract[] }>('/consultant/contracts'),
  sendContractOtp: (id: string, channel?: 'whatsapp' | 'sms') =>
    apiClient.post<{ ok: true; channel: 'whatsapp' | 'sms'; expiresAt: string }>(
      `/consultant/contracts/${encodeURIComponent(id)}/otp`,
      { channel },
    ),
  signContract: (id: string, body: { signatureImagePng: string; code: string }) =>
    apiClient.post<{ contract: ConsultantContract }>(
      `/consultant/contracts/${encodeURIComponent(id)}/sign`,
      body,
    ),
  contractPdfUrl: (id: string) =>
    apiClient.get<{ url: string }>(`/consultant/contracts/${encodeURIComponent(id)}/pdf`),
};
