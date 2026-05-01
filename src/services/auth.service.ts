import { apiClient } from '@/lib/api-client';
import type { LoginInput, SignupInput, OtpInput, ForgotPasswordInput } from '@/lib/validators';
import type { Session, SessionUser } from '@/types/auth';

interface LoginResponse {
  user: SessionUser;
  expiresAt: string;
}

interface SignupResponse {
  userId: string;
  requiresOtp: boolean;
  /** Masked phone for display on OTP page (e.g. +213 *** ** 12 34) */
  maskedPhone: string;
}

interface VerifyOtpResponse {
  user: SessionUser;
  expiresAt: string;
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

  async verifyOtp(input: OtpInput & { userId: string }): Promise<Session> {
    const res = await apiClient.post<VerifyOtpResponse>('/auth/verify-otp', input, {
      skipAuth: true,
    });
    return { user: res.user, expiresAt: new Date(res.expiresAt) };
  },

  async resendOtp(userId: string): Promise<void> {
    await apiClient.post('/auth/resend-otp', { userId }, { skipAuth: true });
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
