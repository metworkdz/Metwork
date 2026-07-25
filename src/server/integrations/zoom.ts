/**
 * Zoom Server-to-Server OAuth integration — auto-generates a meeting for an
 * instant-book consultation when the consultant has no manual meeting link.
 *
 * Single canonical entry point (`createZoomMeeting`) used by every settlement
 * path in `src/server/consultations/lifecycle.ts`. This module never decides
 * fallback behaviour — it throws a typed `ZoomIntegrationError` and the
 * caller decides what to do (per the non-blocking rule: a Zoom failure must
 * never fail, block, or roll back a booking).
 *
 * All three env vars (ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET)
 * are optional — `isZoomConfigured()` lets callers skip Zoom entirely (same
 * shape as the SlickPay `readConfig() === null` pattern) rather than always
 * hitting the network only to fail.
 */

const OAUTH_URL = 'https://zoom.us/oauth/token';
const API_BASE = 'https://api.zoom.us/v2';

export class ZoomIntegrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZoomIntegrationError';
  }
}

interface ZoomConfig {
  accountId: string;
  clientId: string;
  clientSecret: string;
}

function readConfig(): ZoomConfig | null {
  const accountId = process.env.ZOOM_ACCOUNT_ID?.trim();
  const clientId = process.env.ZOOM_CLIENT_ID?.trim();
  const clientSecret = process.env.ZOOM_CLIENT_SECRET?.trim();
  if (!accountId || !clientId || !clientSecret) return null;
  return { accountId, clientId, clientSecret };
}

/** True when all three Zoom env vars are present — lets callers skip the network round-trip entirely. */
export function isZoomConfigured(): boolean {
  return readConfig() !== null;
}

interface CachedToken {
  accessToken: string;
  /** Epoch ms after which the token is considered stale (with a safety margin). */
  expiresAt: number;
}

// Module-level cache: reset on cold start, which is fine — it's an
// optimization, not a correctness requirement (a stale token just gets a
// fresh one fetched).
let cachedToken: CachedToken | null = null;

/**
 * Server-to-Server OAuth `account_credentials` grant. Caches the token
 * in-memory until shortly before its 1-hour expiry, then refreshes.
 * Throws `ZoomIntegrationError` on any failure — never returns a falsy token.
 */
export async function getZoomAccessToken(): Promise<string> {
  const cfg = readConfig();
  if (!cfg) throw new ZoomIntegrationError('Zoom not configured: ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET required');

  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now) return cachedToken.accessToken;

  const basicAuth = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64');
  const res = await fetch(OAUTH_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'account_credentials',
      account_id: cfg.accountId,
    }),
  });

  if (!res.ok) {
    // Never include the response body — it can echo back request params.
    throw new ZoomIntegrationError(`Zoom OAuth token request failed (${res.status})`);
  }

  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new ZoomIntegrationError('Zoom OAuth response missing access_token');

  // 60s safety margin before the real 1-hour expiry.
  const ttlMs = Math.max(0, (json.expires_in ?? 3600) - 60) * 1000;
  cachedToken = { accessToken: json.access_token, expiresAt: now + ttlMs };
  return cachedToken.accessToken;
}

export interface CreateZoomMeetingInput {
  topic: string;
  /** ISO 8601 start time, e.g. "2026-07-25T14:00:00" (interpreted with `timezone`). */
  startTime: string;
  durationMinutes: number;
  /** IANA timezone, e.g. "Africa/Algiers". Defaults to Algiers (the platform's operating timezone). */
  timezone?: string;
  /** Zoom user to host the meeting under. Defaults to the account's own user ("me"). */
  hostEmail?: string;
}

export interface CreateZoomMeetingResult {
  joinUrl: string;
  startUrl: string;
  meetingId: string;
}

/**
 * Creates a scheduled Zoom meeting via `POST /users/{userId}/meetings`.
 * Throws `ZoomIntegrationError` on any failure — the caller decides the
 * fallback (per the non-blocking rule), this function never swallows errors.
 */
export async function createZoomMeeting(input: CreateZoomMeetingInput): Promise<CreateZoomMeetingResult> {
  const accessToken = await getZoomAccessToken();
  const userId = input.hostEmail ?? 'me';

  const res = await fetch(`${API_BASE}/users/${encodeURIComponent(userId)}/meetings`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      topic: input.topic,
      type: 2, // scheduled meeting
      start_time: input.startTime,
      duration: input.durationMinutes,
      timezone: input.timezone ?? 'Africa/Algiers',
      settings: {
        join_before_host: true,
        waiting_room: false,
      },
    }),
  });

  if (!res.ok) {
    throw new ZoomIntegrationError(`Zoom meeting creation failed (${res.status})`);
  }

  const json = (await res.json()) as { join_url?: string; start_url?: string; id?: number | string };
  if (!json.join_url || !json.start_url || json.id == null) {
    throw new ZoomIntegrationError('Zoom meeting response missing join_url/start_url/id');
  }

  return {
    joinUrl: json.join_url,
    startUrl: json.start_url,
    meetingId: String(json.id),
  };
}
