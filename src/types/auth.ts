/**
 * User roles in the Metwork platform.
 * These map 1:1 with the `role` enum in the Prisma schema.
 */
export const USER_ROLES = ['ENTREPRENEUR', 'INVESTOR', 'INCUBATOR', 'ADMIN'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/**
 * Roles a user can self-select at signup.
 * ADMIN is provisioned manually only.
 */
export const SIGNUP_ROLES = ['ENTREPRENEUR', 'INVESTOR', 'INCUBATOR'] as const;
export type SignupRole = (typeof SIGNUP_ROLES)[number];

export type UserStatus = 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED' | 'BANNED';

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  phone: string;
  city: string;
  role: UserRole;
  status: UserStatus;
  phoneVerified: boolean;
  emailVerified: boolean;
  membershipCode: string | null;
  avatarUrl: string | null;
  locale: 'en' | 'fr' | 'ar';
}

export interface Session {
  user: SessionUser;
  expiresAt: Date;
}
