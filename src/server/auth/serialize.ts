/**
 * Convert internal UserRecord (which holds passwordHash) into the
 * SessionUser shape returned to the client. Anything that should never
 * leak to the browser must be stripped here.
 */
import type { UserRecord } from '@/server/db/store';
import type { SessionUser } from '@/types/auth';

export function toSessionUser(u: UserRecord): SessionUser {
  return {
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    phone: u.phone,
    city: u.city,
    role: u.role,
    status: u.status,
    phoneVerified: u.phoneVerified,
    emailVerified: u.emailVerified,
    membershipCode: u.membershipCode,
    avatarUrl: u.avatarUrl,
    locale: u.locale,
  };
}

/**
 * Show only the last two digits, with the country prefix preserved when
 * detectable. Used on the OTP-verification screen.
 */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return phone;
  const last2 = digits.slice(-2);
  if (digits.startsWith('213')) return `+213 ••• •• •• ${last2}`;
  if (digits.startsWith('0')) return `0••• •• •• ${last2}`;
  return `••• •• •• ${last2}`;
}

/**
 * Normalize an Algerian phone for storage: strip spaces / dashes,
 * keeping a leading "+" if present.
 */
export function normalizePhone(phone: string): string {
  const trimmed = phone.trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  return hasPlus ? `+${digits}` : digits;
}
