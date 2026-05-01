import { clientEnvVars } from './env';
import type { ApiError } from '@/types/domain';

/**
 * API base URL — points to the NestJS backend.
 * On the server we use the internal URL; on the client, the public one.
 */
function getBaseUrl(): string {
  if (typeof window === 'undefined') {
    return process.env.API_INTERNAL_URL ?? clientEnvVars.NEXT_PUBLIC_API_URL;
  }
  return clientEnvVars.NEXT_PUBLIC_API_URL;
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
  const { body, skipAuth, locale, headers, ...rest } = options;

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
    credentials: skipAuth ? 'omit' : 'include',
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
