/**
 * The one door to the video host. Pages, entitlements and uploads talk to this
 * interface only, so moving host means one new adapter (and re-uploading the
 * videos), nothing else. Implementations: `vdocipher.ts` (production) and
 * `mock.ts` (local work and tests).
 *
 * Security rules every implementation keeps:
 *   - a provider video id never reaches a browser except inside a playback
 *     token minted for one signed-in viewer (see `createPlaybackToken`);
 *   - the caller has already checked the viewer may watch the lesson;
 *   - every token carries the viewer's watermark.
 */

export type ProviderVideoStatus = 'UPLOADING' | 'PROCESSING' | 'READY' | 'FAILED';

export interface ProviderVideo {
  videoId: string;
  status: ProviderVideoStatus;
  /** Whole seconds, once known. */
  durationSec: number | null;
  posterUrl: string | null;
}

/** Where the browser sends the file: a form POST straight to the host's storage. */
export interface UploadTicket {
  videoId: string;
  url: string;
  /** Form fields to send before the file, in this order. */
  fields: Record<string, string>;
  /** Name of the form field that carries the file. */
  fileField: string;
}

export interface PlaybackToken {
  otp: string;
  playbackInfo: string;
  expiresAt: string;
}

export interface VideoProvider {
  readonly code: 'mock' | 'vdocipher';
  /** Reserve a video and get a direct-upload ticket (the file never transits our servers). */
  createUpload(input: { title: string }): Promise<UploadTicket>;
  /** Current state of a video, or null when the host does not know it. */
  getVideo(videoId: string): Promise<ProviderVideo | null>;
  /** A short-lived token for one viewer, with their watermark burnt into playback. */
  createPlaybackToken(input: { videoId: string; watermark: string; ttlSec: number }): Promise<PlaybackToken>;
  deleteVideo(videoId: string): Promise<void>;
  /** Attach a WebVTT subtitle track (ISO 639-1 language); returns the host's file id. */
  addSubtitle(input: { videoId: string; language: 'fr' | 'en' | 'ar'; vtt: string }): Promise<string>;
  /** Remove a subtitle track. A track the host no longer has is not an error. */
  deleteSubtitle(input: { videoId: string; fileId: string }): Promise<void>;
}

export class VideoProviderError extends Error {
  constructor(message: string, readonly code: 'NOT_CONFIGURED' | 'BAD_ID' | 'UPSTREAM' | 'NOT_FOUND') {
    super(message);
    this.name = 'VideoProviderError';
  }
}

/** Playback tokens live this long: enough to start the video, too short to share. */
export const PLAYBACK_TOKEN_TTL_SEC = 300;
