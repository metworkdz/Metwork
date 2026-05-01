import { cookies } from 'next/headers';
import { cache } from 'react';
import { apiClient } from '@/lib/api-client';
import { serverEnvVars } from '@/lib/env';
import type { SessionUser } from '@/types/auth';

/**
 * Server-side session getter. Cached per request so multiple
 * RSCs in the same request don't hit the API repeatedly.
 *
 * Forwards the session cookie to the backend's /auth/me endpoint,
 * which validates it and returns the current user.
 */
export const getServerSession = cache(async (): Promise<SessionUser | null> => {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(serverEnvVars.AUTH_COOKIE_NAME);

  if (!sessionCookie?.value) return null;

  try {
    return await apiClient.get<SessionUser>('/auth/me', {
      headers: {
        Cookie: `${serverEnvVars.AUTH_COOKIE_NAME}=${sessionCookie.value}`,
      },
    });
  } catch {
    return null;
  }
});
