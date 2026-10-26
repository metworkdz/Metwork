/**
 * Video host stand-in for local work and tests. Never selectable in production
 * (see `getVideoProvider`).
 *
 * Stateless on purpose: in `next dev` every route bundle has its own copy of
 * this module, so a video uploaded through one route must still be "known" to
 * the next. Any well-formed id is READY with a 90-second length, unless it was
 * deleted in this same instance.
 */
import { randomBytes } from 'node:crypto';
import { VideoProviderError, type VideoProvider } from './provider';

export const MOCK_VIDEO_DURATION_SEC = 90;
const ID_RE = /^[a-f0-9]{32}$/;

export function createMockVideoProvider(): VideoProvider & { reset(): void; tokens: { videoId: string; watermark: string }[] } {
  const deleted = new Set<string>();
  const tokens: { videoId: string; watermark: string }[] = [];
  const known = (id: string) => ID_RE.test(id) && !deleted.has(id);
  return {
    code: 'mock',
    tokens,
    reset() { deleted.clear(); tokens.length = 0; },
    async createUpload() {
      const videoId = randomBytes(16).toString('hex');
      return { videoId, url: '/api/academy/mock-upload', fields: { videoId }, fileField: 'file' };
    },
    async getVideo(videoId) {
      return known(videoId) ? { videoId, status: 'READY', durationSec: MOCK_VIDEO_DURATION_SEC, posterUrl: null } : null;
    },
    async createPlaybackToken({ videoId, watermark, ttlSec }) {
      if (!known(videoId)) throw new VideoProviderError('Unknown video', 'NOT_FOUND');
      tokens.push({ videoId, watermark });
      return { otp: `mock-otp-${videoId.slice(0, 8)}`, playbackInfo: 'mock', expiresAt: new Date(Date.now() + ttlSec * 1000).toISOString() };
    },
    async deleteVideo(videoId) {
      deleted.add(videoId);
    },
  };
}
