/**
 * Picks the video host from ACADEMY_VIDEO_PROVIDER ('mock' by default,
 * 'vdocipher' in production). Production refuses the mock: a mock there would
 * hand out fake tokens and play nothing, which is worse than a clear error.
 */
import { serverEnvVars } from '@/lib/env';
import { createMockVideoProvider } from './mock';
import { VideoProviderError, type VideoProvider } from './provider';
import { createVdoCipherProvider } from './vdocipher';

let cached: VideoProvider | null = null;

export function getVideoProvider(): VideoProvider {
  if (cached) return cached;
  const code = serverEnvVars.ACADEMY_VIDEO_PROVIDER;
  if (code === 'vdocipher') {
    const secret = serverEnvVars.VDOCIPHER_API_SECRET;
    if (!secret) throw new VideoProviderError('VDOCIPHER_API_SECRET is not set', 'NOT_CONFIGURED');
    cached = createVdoCipherProvider(secret);
  } else {
    if (process.env.NODE_ENV === 'production') {
      throw new VideoProviderError('ACADEMY_VIDEO_PROVIDER must be "vdocipher" in production', 'NOT_CONFIGURED');
    }
    cached = createMockVideoProvider();
  }
  return cached;
}

/** Tests only. */
export function setVideoProviderForTests(p: VideoProvider | null): void {
  cached = p;
}

export { PLAYBACK_TOKEN_TTL_SEC, VideoProviderError } from './provider';
export type { VideoProvider, ProviderVideo, PlaybackToken, UploadTicket } from './provider';
