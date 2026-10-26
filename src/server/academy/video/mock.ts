/**
 * In-memory video host for local work and tests. Never selectable in
 * production (see `getVideoProvider`). Uploads become READY at once with a
 * 90-second length so the builder and player can be exercised end to end.
 */
import { randomBytes } from 'node:crypto';
import { VideoProviderError, type ProviderVideo, type VideoProvider } from './provider';

export const MOCK_VIDEO_DURATION_SEC = 90;

export function createMockVideoProvider(): VideoProvider & { reset(): void; tokens: { videoId: string; watermark: string }[] } {
  const videos = new Map<string, ProviderVideo>();
  const tokens: { videoId: string; watermark: string }[] = [];
  return {
    code: 'mock',
    tokens,
    reset() { videos.clear(); tokens.length = 0; },
    async createUpload() {
      const videoId = randomBytes(16).toString('hex');
      videos.set(videoId, { videoId, status: 'READY', durationSec: MOCK_VIDEO_DURATION_SEC, posterUrl: null });
      return { videoId, url: '/api/academy/mock-upload', fields: { videoId }, fileField: 'file' };
    },
    async getVideo(videoId) {
      return videos.get(videoId) ?? null;
    },
    async createPlaybackToken({ videoId, watermark, ttlSec }) {
      if (!videos.has(videoId)) throw new VideoProviderError('Unknown video', 'NOT_FOUND');
      tokens.push({ videoId, watermark });
      return { otp: `mock-otp-${videoId.slice(0, 8)}`, playbackInfo: 'mock', expiresAt: new Date(Date.now() + ttlSec * 1000).toISOString() };
    },
    async deleteVideo(videoId) {
      videos.delete(videoId);
    },
  };
}
