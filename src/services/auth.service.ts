import { apiClient } from '@/lib/api-client';
import type { LoginInput, SignupInput, OtpInput, ForgotPasswordInput } from '@/lib/validators';
import type { Session, SessionUser } from '@/types/auth';
import type { CardBookingTargetInput } from '@/services/booking.service';

interface LoginResponse {
  user: SessionUser;
  expiresAt: string;
}

interface SignupResponse {
  userId: string;
  requiresOtp: boolean;
  /** Masked phone for display on OTP page (e.g. +213 *** ** 12 34) */
  maskedPhone: string;
  /** Masked email for display on OTP page (e.g. u***@example.com) */
  maskedEmail: string;
}

interface VerifyOtpResponse {
  user: SessionUser;
  expiresAt: string;
  /**
   * Optional post-verification destination. Set when the new account was
   * created from a booking ("Book & create an account") — the server computes
   * the pay page (space/program) or pending-approval page (consultation) and
   * the OTP form redirects there instead of the dashboard.
   */
  redirect?: string;
}

/**
 * "Book & create an account" — register a pending account tied to an
 * in-flight booking. The server creates the booking intent (card flows) or
 * links an existing guest consultation request, then issues an EMAIL OTP.
 * No price travels through the client; the carry pointer lives server-side on
 * the pending-user record.
 */
export type SignupPendingIntent =
  | {
      kind: 'CARD';
      target: CardBookingTargetInput;
      paymentMode: 'ONLINE_FULL' | 'CASH_DEPOSIT';
      promoCode?: string;
      /** Idempotency key — reuse across retries to avoid double bookings. */
      clientReference: string;
    }
  | { kind: 'CONSULTATION'; mentorBookingId: string };

export interface SignupPendingInput {
  fullName: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
  city: string;
  locale?: 'en' | 'fr' | 'ar';
  intent: SignupPendingIntent;
}

export interface SignupPendingResponse {
  /** Pending-user id — passed unchanged to verify-otp. */
  userId: string;
  maskedPhone: string;
  maskedEmail: string;
}

/**
 * Frontend auth service. All calls go through the typed API client
 * to the NestJS backend, which holds session cookies, hashes passwords,
 * and issues OTPs.
 */
export const authService = {
  async login(input: LoginInput): Promise<Session> {
    const res = await apiClient.post<LoginResponse>('/auth/login', input, {
      skipAuth: true,
    });
    return { user: res.user, expiresAt: new Date(res.expiresAt) };
  },

  async signup(input: SignupInput): Promise<SignupResponse> {
    return apiClient.post<SignupResponse>('/auth/signup', input, { skipAuth: true });
  },

  /**
   * Create a pending account tied to an in-flight booking ("Book & create an
   * account"). Returns the pending-user id + masked contact for the OTP page.
   */
  async signupPending(input: SignupPendingInput): Promise<SignupPendingResponse> {
    return apiClient.post<SignupPendingResponse>('/auth/signup-pending', input, {
      skipAuth: true,
    });
  },

  async verifyOtp(input: OtpInput & { userId: string }): Promise<Session & { redirect?: string }> {
    const res = await apiClient.post<VerifyOtpResponse>('/auth/verify-otp', input, {
      skipAuth: true,
    });
    return { user: res.user, expiresAt: new Date(res.expiresAt), redirect: res.redirect };
  },

  async resendOtp(userId: string, channel: 'whatsapp' | 'sms' | 'email' = 'whatsapp'): Promise<void> {
    await apiClient.post('/auth/resend-otp', { userId, channel }, { skipAuth: true });
  },

  async forgotPassword(input: ForgotPasswordInput): Promise<void> {
    await apiClient.post('/auth/forgot-password', input, { skipAuth: true });
  },

  async resetPassword(input: { token: string; password: string; confirmPassword: string }): Promise<void> {
    await apiClient.post('/auth/reset-password', input, { skipAuth: true });
  },

  async logout(): Promise<void> {
    await apiClient.post('/auth/logout');
  },

  async me(): Promise<SessionUser | null> {
    try {
      return await apiClient.get<SessionUser>('/auth/me');
    } catch {
      return null;
    }
  },
};
