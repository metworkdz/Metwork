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
    membershipExpiresAt: u.membershipExpiresAt ?? null,
    scheduledMembershipChange: u.scheduledMembershipChange ?? null,
    scheduledChangeDate: u.scheduledChangeDate ?? null,
    avatarUrl: u.avatarUrl,
    locale: u.locale,
    // Network Pass / tier fields — optional; omitted when not yet set on record
    ...(u.membershipTier        !== undefined && { membershipTier: u.membershipTier }),
    ...(u.membershipStartDate   !== undefined && { membershipStartDate: u.membershipStartDate }),
    ...(u.networkCredits        !== undefined && { networkCredits: u.networkCredits }),
    ...(u.networkCreditsMax     !== undefined && { networkCreditsMax: u.networkCreditsMax }),
    ...(u.networkCreditsResetDate !== undefined && { networkCreditsResetDate: u.networkCreditsResetDate }),
  };
}

/**
 * Show only the first character of the local part, mask the rest.
 * e.g. user@example.com → u***@example.com
 */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return email;
  const local = email.slice(0, at);
  const domain = email.slice(at);
  return `${local.slice(0, 1)}***${domain}`;
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
 * Normalize any Algerian phone number to E.164 format (+213XXXXXXXXX).
 *
 * Handles all common input formats:
 *   +213 550 00 00 00  →  +213550000000
 *   0550 00 00 00      →  +213550000000
 *   550 00 00 00       →  +213550000000  (9-digit bare number)
 *   213550000000       →  +213550000000
 */
export function normalizePhone(phone: string): string {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, '');

  // Already E.164: +213XXXXXXXXX
  if (trimmed.startsWith('+')) {
    return `+${digits}`;
  }
  // Local format: 0XXXXXXXXX (10 digits)
  if (digits.startsWith('0') && digits.length === 10) {
    return `+213${digits.slice(1)}`;
  }
  // Country code without +: 213XXXXXXXXX (12 digits)
  if (digits.startsWith('213') && digits.length === 12) {
    return `+${digits}`;
  }
  // Bare 9-digit local number (e.g. 550000000)
  if (digits.length === 9 && /^[5-7]/.test(digits)) {
    return `+213${digits}`;
  }
  // Fallback: add + and use as-is
  return `+${digits}`;
}
