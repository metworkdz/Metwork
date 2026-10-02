/**
 * Feedback links.
 *
 * A link is signed, not stored: `p.<inviteId>.<sig>` for a participant's
 * personal link, `s.<formId>.<version>.<sig>` for the shared one. The
 * signature is an HMAC with AUTH_SECRET, so
 *  - a leaked store holds nothing that opens a form,
 *  - resending an invite sends the same link (no "old email stopped working"),
 *  - bumping the form's `sharedLinkVersion` retires every shared link at once.
 *
 * Server-only (node:crypto, the secret).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { serverEnvVars } from '@/lib/env';

/** 32 base64url characters = 192 bits — far beyond guessing. */
const SIG_LENGTH = 32;
const MAX_TOKEN_LENGTH = 200;
const ID = /^[A-Za-z0-9-]{1,64}$/;

function sign(payload: string): string {
  return createHmac('sha256', serverEnvVars.AUTH_SECRET)
    .update(`metwork-feedback:${payload}`)
    .digest('base64url')
    .slice(0, SIG_LENGTH);
}

function sameSig(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function personalFeedbackToken(inviteId: string): string {
  return `p.${inviteId}.${sign(`p:${inviteId}`)}`;
}

export function sharedFeedbackToken(formId: string, version: number): string {
  return `s.${formId}.${version}.${sign(`s:${formId}:${version}`)}`;
}

export type ParsedFeedbackToken =
  | { kind: 'PERSONAL'; inviteId: string }
  | { kind: 'SHARED'; formId: string; version: number };

/** The link's target, or null for anything forged, truncated or malformed. */
export function parseFeedbackToken(token: string): ParsedFeedbackToken | null {
  if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH) return null;
  const parts = token.split('.');
  if (parts[0] === 'p' && parts.length === 3) {
    const [, inviteId, sig] = parts as [string, string, string];
    if (!ID.test(inviteId)) return null;
    return sameSig(sig, sign(`p:${inviteId}`)) ? { kind: 'PERSONAL', inviteId } : null;
  }
  if (parts[0] === 's' && parts.length === 4) {
    const [, formId, versionRaw, sig] = parts as [string, string, string, string];
    if (!ID.test(formId) || !/^\d{1,6}$/.test(versionRaw)) return null;
    const version = Number(versionRaw);
    return sameSig(sig, sign(`s:${formId}:${version}`)) ? { kind: 'SHARED', formId, version } : null;
  }
  return null;
}

export function feedbackUrl(token: string, lang: 'fr' | 'en' | 'ar' = 'fr'): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://metwork.dz').replace(/\/+$/, '');
  return `${base}/${lang}/feedback/${token}`;
}
