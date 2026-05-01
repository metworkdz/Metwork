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
) => Promise<Buffer>;

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
