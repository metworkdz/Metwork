/**
 * The text drawn over every video for one viewer: first name, initial, masked
 * phone and an account code. Enough for Metwork to trace a leaked recording to
 * an account; not enough for a stranger to contact the viewer.
 */
import { createHmac } from 'node:crypto';
import { serverEnvVars } from '@/lib/env';

/**
 * A stable 6-character code per account. Keyed with AUTH_SECRET so the code
 * cannot be computed from a user id by anyone else, while support can look it
 * up from the id (`accountCode(userId)`).
 */
export function accountCode(userId: string, secret: string = serverEnvVars.AUTH_SECRET): string {
  return createHmac('sha256', secret).update(`academy-wm:${userId}`).digest('hex').slice(0, 6).toUpperCase();
}

/** Keep the last 2 digits; the operator prefix and the rest are masked. */
export function maskPhone(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (digits.length < 6) return null;
  return `•• •• •• ${digits.slice(-2)}`;
}

function shortName(fullName: string | null | undefined): string {
  const parts = (fullName ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  const first = parts[0]!.slice(0, 24);
  const last = parts.length > 1 ? ` ${parts[parts.length - 1]![0]}.` : '';
  return `${first}${last}`;
}

export function watermarkLabel(
  user: { id: string; fullName?: string | null; phone?: string | null },
  secret?: string,
): string {
  const bits = [shortName(user.fullName), maskPhone(user.phone), `U-${accountCode(user.id, secret)}`].filter(Boolean);
  return bits.join(' · ').slice(0, 80);
}
