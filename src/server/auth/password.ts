/**
 * Password hashing using Node's built-in scrypt (no native bcrypt dep).
 * scrypt is memory-hard and OWASP-recommended for password storage.
 *
 * Storage format: scrypt$<saltHex>$<hashHex>
 */
import { promisify } from 'node:util';
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: string,
  keylen: number,
  options?: { N?: number; r?: number; p?: number },
) => Promise<Buffer>;

/**
 * scrypt work-factor parameters.
 *
 * NOTE (MED-08): Node's built-in scrypt defaults to N=16384 (2^14), which is
 * below the OWASP-recommended minimum of N=65536 (2^16). Increasing N here
 * would silently break verification for all existing password hashes because
 * the raw output format does not embed the parameters (unlike bcrypt).
 * A proper migration requires:
 *   1. Adding a version prefix ("v2:") to new hashes.
 *   2. Branching in verifyPassword on the prefix to pick the right N.
 *   3. A background re-hash job on next successful login.
 * This is tracked as a follow-up task. Until then N stays at the default.
 */

const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, KEY_LENGTH);
  return `scrypt$${salt}$${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = parts[1];
  const hashHex = parts[2];
  if (!salt || !hashHex) return false;
  let expected: Buffer;
  try {
    expected = Buffer.from(hashHex, 'hex');
  } catch {
    return false;
  }
  const derived = await scrypt(password, salt, expected.length);
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(expected, derived);
}
