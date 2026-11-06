/**
 * The four LinkedIn calls a certificate post needs, nothing more:
 *   1. send the participant to LinkedIn's consent screen;
 *   2. trade the returned code for an access token;
 *   3. read who they are (the post's author);
 *   4. upload the certificate image, then publish the post.
 *
 * Scopes: `openid profile` (who is posting) and `w_member_social` (post as
 * them) — both self-serve LinkedIn products. The access token is used inside
 * the one request that receives it and is never stored.
 *
 * Docs: learn.microsoft.com/linkedin — Posts API, Images API, little format.
 */
import type { LinkedInConfig } from './config';

const AUTH_URL = 'https://www.linkedin.com/oauth/v2/authorization';
const TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
const USERINFO_URL = 'https://api.linkedin.com/v2/userinfo';
const IMAGES_URL = 'https://api.linkedin.com/rest/images?action=initializeUpload';
const POSTS_URL = 'https://api.linkedin.com/rest/posts';

export const LINKEDIN_SCOPES = 'openid profile w_member_social';

const TIMEOUT_MS = 20_000;

export class LinkedInApiError extends Error {
  constructor(readonly step: string, readonly status: number, detail: string) {
    super(`LinkedIn ${step} failed (${status}): ${detail.slice(0, 300)}`);
  }
}

async function call(step: string, url: string, init: RequestInit): Promise<Response> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), cache: 'no-store' });
  if (!res.ok) throw new LinkedInApiError(step, res.status, await res.text().catch(() => ''));
  return res;
}

function restHeaders(config: LinkedInConfig, token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'LinkedIn-Version': config.apiVersion,
    'X-Restli-Protocol-Version': '2.0.0',
    'Content-Type': 'application/json',
  };
}

export function authorizeUrl(config: LinkedInConfig, redirectUri: string, state: string): string {
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: redirectUri,
    state,
    scope: LINKEDIN_SCOPES,
  });
  return `${AUTH_URL}?${q.toString()}`;
}

export async function exchangeCode(config: LinkedInConfig, code: string, redirectUri: string): Promise<string> {
  const res = await call('token', TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }).toString(),
  });
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new LinkedInApiError('token', 200, 'no access_token');
  return json.access_token;
}

export interface LinkedInMember { id: string; name: string }

export async function fetchMember(token: string): Promise<LinkedInMember> {
  const res = await call('userinfo', USERINFO_URL, { headers: { Authorization: `Bearer ${token}` } });
  const json = (await res.json()) as { sub?: string; name?: string };
  if (!json.sub || !/^[A-Za-z0-9_-]{1,64}$/.test(json.sub)) throw new LinkedInApiError('userinfo', 200, 'no member id');
  return { id: json.sub, name: json.name ?? '' };
}

/** Upload a PNG owned by the member; returns its `urn:li:image:…`. */
export async function uploadImage(config: LinkedInConfig, token: string, memberUrn: string, png: Buffer): Promise<string> {
  const init = await call('image-init', IMAGES_URL, {
    method: 'POST',
    headers: restHeaders(config, token),
    body: JSON.stringify({ initializeUploadRequest: { owner: memberUrn } }),
  });
  const json = (await init.json()) as { value?: { uploadUrl?: string; image?: string } };
  const uploadUrl = json.value?.uploadUrl;
  const image = json.value?.image;
  // The upload goes only to LinkedIn's own host — never to a URL we did not expect.
  if (!uploadUrl || !image || !/^https:\/\/([a-z0-9-]+\.)*linkedin\.com\//i.test(uploadUrl)) {
    throw new LinkedInApiError('image-init', 200, 'unexpected upload target');
  }
  await call('image-upload', uploadUrl, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/png' },
    body: new Uint8Array(png),
  });
  return image;
}

/** Publish the post; returns its URN (`urn:li:share:…` or `urn:li:ugcPost:…`). */
export async function createImagePost(
  config: LinkedInConfig,
  token: string,
  input: { authorUrn: string; commentary: string; imageUrn: string; altText: string },
): Promise<string> {
  const res = await call('post', POSTS_URL, {
    method: 'POST',
    headers: restHeaders(config, token),
    body: JSON.stringify({
      author: input.authorUrn,
      commentary: input.commentary,
      visibility: 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      content: { media: { id: input.imageUrn, altText: input.altText.slice(0, 120) } },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    }),
  });
  const urn = res.headers.get('x-restli-id') ?? '';
  if (!/^urn:li:(share|ugcPost):\d+$/.test(urn)) throw new LinkedInApiError('post', res.status, 'no post id');
  return urn;
}

export function postUrl(postUrn: string): string {
  return `https://www.linkedin.com/feed/update/${postUrn}/`;
}
