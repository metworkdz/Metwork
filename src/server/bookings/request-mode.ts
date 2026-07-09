/**
 * Shared helpers for REQUEST-mode ("Request to Book") space reservations.
 *
 * The payment-link token follows the password-reset pattern: a random
 * base64url token is sent to the client (email only), and ONLY its SHA-256
 * hash is stored on the booking — a DB leak never exposes a usable link.
 */
import { createHash, randomBytes } from 'node:crypto';

function ttlFromEnv(name: string, fallbackHours: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallbackHours;
}

/** How long an APPROVED_UNPAID payment link stays payable (default 48 h). */
export const PAYMENT_LINK_TTL_HOURS = ttlFromEnv('PAYMENT_LINK_TTL_HOURS', 48);

/** How long an AWAITING_APPROVAL request waits before auto-expiry (default 72 h). */
export const APPROVAL_TTL_HOURS = ttlFromEnv('APPROVAL_TTL_HOURS', 72);

/** Mint a new single-use payment-link token. */
export function newPaymentLinkToken(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256 hex of a raw token — the only form ever stored at rest. */
export function hashPaymentLinkToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}
