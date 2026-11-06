/**
 * LinkedIn sharing — configuration, the share link, and the OAuth state.
 *
 * Server-only (node:crypto, AUTH_SECRET, the app secret).
 *
 * THE SHARE LINK is not the certificate's verification token. That token is
 * printed in the QR code, and the QR code is ON the image we publish — anyone
 * could read it off a post and publish somebody else's certificate as their
 * own. The share link is `<certificateId>.<sig>` (HMAC with AUTH_SECRET) and
 * only ever travels in the participant's own certificate email. Like the
 * feedback links it is signed, not stored: resending the email sends the same
 * link, and rotating AUTH_SECRET retires every one of them.
 *
 * THE OAUTH STATE binds LinkedIn's redirect back to the browser that left:
 * a random nonce goes both into `state` and into a short-lived HttpOnly
 * cookie, signed together with the share token and the language, so a
 * callback cannot be replayed from another browser or pointed at another
 * certificate.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { serverEnvVars } from '@/lib/env';

import type { PostLang } from './post-text';

export interface LinkedInConfig {
  clientId: string;
  clientSecret: string;
  /** Null when unset or malformed: posts go out, Metwork is named but not tagged. */
  organizationId: string | null;
  organizationName: string;
  apiVersion: string;
}

/** Null when the app is not configured — the share button is then hidden. */
export function linkedInConfig(): LinkedInConfig | null {
  const e = serverEnvVars;
  if (!e.LINKEDIN_CLIENT_ID || !e.LINKEDIN_CLIENT_SECRET) return null;
  const orgId = e.LINKEDIN_ORGANIZATION_ID && /^\d{1,20}$/.test(e.LINKEDIN_ORGANIZATION_ID)
    ? e.LINKEDIN_ORGANIZATION_ID
    : null;
  return {
    clientId: e.LINKEDIN_CLIENT_ID,
    clientSecret: e.LINKEDIN_CLIENT_SECRET,
    organizationId: orgId,
    organizationName: e.LINKEDIN_ORGANIZATION_NAME || 'Metwork',
    apiVersion: /^\d{6}$/.test(e.LINKEDIN_API_VERSION) ? e.LINKEDIN_API_VERSION : '202610',
  };
}

export function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? 'https://metwork.dz').replace(/\/+$/, '');
}

export function linkedInRedirectUri(): string {
  return `${appBaseUrl()}/api/certificates/linkedin/callback`;
}

// ── Share link ──────────────────────────────────────────────────────────────

const SIG_LENGTH = 32;
const ID = /^[A-Za-z0-9-]{1,64}$/;

function sign(purpose: string, payload: string): string {
  return createHmac('sha256', serverEnvVars.AUTH_SECRET)
    .update(`metwork-linkedin-${purpose}:${payload}`)
    .digest('base64url')
    .slice(0, SIG_LENGTH);
}

function sameSig(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function certificateShareToken(certificateId: string): string {
  return `${certificateId}.${sign('share', certificateId)}`;
}

/** The certificate id the link was issued for, or null for anything forged. */
export function parseCertificateShareToken(token: string): string | null {
  if (typeof token !== 'string' || token.length > 120) return null;
  const [id, sig, ...rest] = token.split('.');
  if (rest.length || !id || !sig || !ID.test(id)) return null;
  return sameSig(sig, sign('share', id)) ? id : null;
}

export function certificateShareUrl(certificateId: string, lang: PostLang): string {
  return `${appBaseUrl()}/${lang}/attestation/linkedin/${certificateShareToken(certificateId)}`;
}

// ── OAuth state ─────────────────────────────────────────────────────────────

export const LINKEDIN_STATE_COOKIE = 'metwork_li_share';
/** Long enough to sign in to LinkedIn on a phone, short enough to be useless later. */
export const LINKEDIN_STATE_TTL_S = 15 * 60;

export interface OAuthState {
  nonce: string;
  shareToken: string;
  lang: PostLang;
  exp: number;
}

export function newOAuthState(shareToken: string, lang: PostLang, nowMs = Date.now()): OAuthState {
  return {
    nonce: randomBytes(18).toString('base64url'),
    shareToken,
    lang,
    exp: Math.floor(nowMs / 1000) + LINKEDIN_STATE_TTL_S,
  };
}

export function sealOAuthState(state: OAuthState): string {
  const body = Buffer.from(JSON.stringify(state)).toString('base64url');
  return `${body}.${sign('state', body)}`;
}

/** The cookie's state when it is ours, unexpired, and matches `nonce`. */
export function openOAuthState(cookie: string | undefined, nonce: string | null, nowMs = Date.now()): OAuthState | null {
  if (!cookie || !nonce) return null;
  const [body, sig, ...rest] = cookie.split('.');
  if (rest.length || !body || !sig || !sameSig(sig, sign('state', body))) return null;
  let state: OAuthState;
  try { state = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as OAuthState; }
  catch { return null; }
  if (typeof state.nonce !== 'string' || !sameSig(state.nonce, nonce)) return null;
  if (typeof state.exp !== 'number' || state.exp * 1000 < nowMs) return null;
  if (!['fr', 'en', 'ar'].includes(state.lang) || typeof state.shareToken !== 'string') return null;
  return state;
}
