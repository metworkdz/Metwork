import { clientEnvVars } from './env';
import type { ApiError } from '@/types/domain';

/**
 * API base URL.
 *
 * On the client: always use a relative path (`/api`) so requests are
 * same-origin regardless of which domain the user is on (metwork.dz,
 * metworkdz.vercel.app, preview deploys, etc.). This avoids:
 *   - CSP `connect-src 'self'` blocking cross-origin fetches
 *   - Cookie/credentials issues across origins
 *   - Stale `NEXT_PUBLIC_API_URL` env vars after domain migrations
 *
 * On the server: use `API_INTERNAL_URL` if explicitly set, otherwise fall
 * back to `NEXT_PUBLIC_APP_URL + /api`. Server-side fetches must use an
 * absolute URL — there is no "current origin" on the server.
 */
function getBaseUrl(): string {
  if (typeof window === 'undefined') {
    if (process.env.API_INTERNAL_URL) return process.env.API_INTERNAL_URL;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    if (appUrl) return `${appUrl.replace(/\/$/, '')}/api`;
    return clientEnvVars.NEXT_PUBLIC_API_URL;
  }
  // Browser: always relative — same origin = no CORS, no CSP issues.
  return '/api';
}

export class ApiClientError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(status: number, error: ApiError) {
    super(error.message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = error.code;
    this.details = error.details;
  }
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Skip auth cookie (for public endpoints) */
  skipAuth?: boolean;
  /** Locale to send via Accept-Language */
  locale?: string;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, skipAuth: _skipAuth, locale, headers, ...rest } = options;

  const url = path.startsWith('http') ? path : `${getBaseUrl()}${path}`;

  const finalHeaders: HeadersInit = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(locale ? { 'Accept-Language': locale } : {}),
    ...headers,
  };

  const response = await fetch(url, {
    ...rest,
    headers: finalHeaders,
    // Always include credentials so the browser stores Set-Cookie headers
    // from auth responses (login, verify-otp) and sends the session cookie
    // on authenticated requests. 'skipAuth' controls business logic only —
    // it must not suppress cookie storage or the login flow breaks.
    credentials: 'include',
    body: body ? JSON.stringify(body) : undefined,
  });

  if (response.status === 204) {
    return undefined as T;
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const apiError = (data as { error?: ApiError })?.error ?? {
      code: 'UNKNOWN',
      message: response.statusText || 'Request failed',
    };
    throw new ApiClientError(response.status, apiError);
  }

  return data as T;
}

export const apiClient = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'body'>) =>
    request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, options?: Omit<RequestOptions, 'body'>) =>
    request<T>(path, { ...options, method: 'DELETE' }),
};
