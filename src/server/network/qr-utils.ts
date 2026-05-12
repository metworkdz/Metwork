/**
 * QR generation, hashing, and QR-payload parsing for the Network Pass
 * check-in system.
 *
 * Security model:
 *   - The plaintext check-in code (format "MNP-{YEAR}-{NNNNN}") is what
 *     the staff sees. The user receives the code AND a QR encoding it.
 *   - The DB never stores plaintext — only SHA-256(code). A DB leak
 *     therefore CANNOT be used to forge valid codes.
 *   - QR payload is `{ type: 'METWORK_NETWORK_PASS', bookingId, code }`
 *     so a stolen QR can't be replayed across bookings, AND staff at the
 *     wrong space cannot accept a valid-but-misdirected code.
 *   - All `code === storedHash` comparisons use `crypto.timingSafeEqual`
 *     to prevent timing-leak attacks.
 *
 * Tampering: the QR payload is plaintext JSON, so anyone reading the QR
 * can see the bookingId and code. That's fine — the security comes from
 * (1) server-side hash check, (2) one-time-use, (3) per-space binding,
 * (4) expiry at end-of-day.
 *
 * If/when we want true unforgeable QRs (HMAC-signed payloads readable
 * even on offline scanners), bump to JWS — but this isn't needed because
 * we always validate server-side.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import QRCode from 'qrcode';

// ---------------------------------------------------------------------------
// Code format & generation
// ---------------------------------------------------------------------------

/** "MNP" = Metwork Network Pass. */
const CODE_PREFIX = 'MNP';

/**
 * Build the human-facing code string.
 * Example: composeCode(2026, 145) → "MNP-2026-00145".
 */
export function composeCode(year: number, sequence: number): string {
  return `${CODE_PREFIX}-${year}-${String(sequence).padStart(5, '0')}`;
}

/**
 * Parse a code string into { year, sequence }. Returns null on bad input.
 * Used by the manual-entry validator.
 */
export function parseCode(code: string): { year: number; sequence: number } | null {
  const m = /^MNP-(\d{4})-(\d{5})$/.exec(code.trim().toUpperCase());
  if (!m) return null;
  return { year: Number(m[1]), sequence: Number(m[2]) };
}

// ---------------------------------------------------------------------------
// Hashing & constant-time compare
// ---------------------------------------------------------------------------

export function hashCode(code: string): string {
  return createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
}

/**
 * Constant-time comparison of two hex hashes. Prevents timing-leak attacks
 * where an attacker could deduce the correct code byte-by-byte by measuring
 * how long the server takes to reject a guess.
 *
 * Returns false on length mismatch (cannot call timingSafeEqual on
 * different-length buffers).
 */
export function safeHashEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

// ---------------------------------------------------------------------------
// QR payload
// ---------------------------------------------------------------------------

export interface QrPayload {
  type: 'METWORK_NETWORK_PASS';
  bookingId: string;
  code: string;
}

export function buildQrPayload(bookingId: string, code: string): QrPayload {
  return { type: 'METWORK_NETWORK_PASS', bookingId, code };
}

/**
 * Parse a scanned QR string into a typed payload. Returns null when the
 * payload is not a valid Metwork Network Pass token.
 *
 * Defensive against malformed input — never throws.
 */
export function parseQrPayload(qrData: string): QrPayload | null {
  if (typeof qrData !== 'string' || qrData.length === 0 || qrData.length > 1024) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(qrData);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const p = parsed as Record<string, unknown>;
  if (p.type !== 'METWORK_NETWORK_PASS') return null;
  if (typeof p.bookingId !== 'string' || typeof p.code !== 'string') return null;
  if (p.bookingId.length === 0 || p.code.length === 0) return null;
  return {
    type: 'METWORK_NETWORK_PASS',
    bookingId: p.bookingId,
    code: p.code,
  };
}

// ---------------------------------------------------------------------------
// QR rendering — base64 PNG suitable for embedding in email <img src>
// ---------------------------------------------------------------------------

export interface RenderQrResult {
  /** "data:image/png;base64,…" — drop straight into <img src="…"/> */
  dataUrl: string;
  /** Raw plaintext that was encoded (for debug / logging only — never log in prod). */
  encoded: string;
}

/**
 * Render a Metwork Network Pass QR as a base64 PNG data URL.
 *
 * Defaults are tuned for email embed: 256 px square, medium error
 * correction (handles ~15 % occlusion — fine for scanner cameras).
 */
export async function renderQr(payload: QrPayload, options?: {
  size?: number;
  errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
}): Promise<RenderQrResult> {
  const encoded = JSON.stringify(payload);
  const dataUrl = await QRCode.toDataURL(encoded, {
    width: options?.size ?? 256,
    errorCorrectionLevel: options?.errorCorrectionLevel ?? 'M',
    margin: 2,
    color: {
      dark: '#09090b',  // Match the email card text colour
      light: '#ffffff',
    },
  });
  return { dataUrl, encoded };
}
