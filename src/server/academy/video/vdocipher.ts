/**
 * VdoCipher adapter (Widevine + FairPlay DRM, dynamic watermark).
 *
 * API reference: https://www.vdocipher.com/docs/server/ — all calls carry
 * `Authorization: Apisecret <secret>`; the secret is server-only.
 *
 * Webhooks from VdoCipher are not signed, so nothing here trusts a webhook
 * body: the webhook route only learns WHICH video changed and re-reads its
 * state with `getVideo`.
 */
import {
  VideoProviderError,
  type PlaybackToken,
  type ProviderVideo,
  type ProviderVideoStatus,
  type UploadTicket,
  type VideoProvider,
} from './provider';

const API_BASE = 'https://dev.vdocipher.com/api';
const TIMEOUT_MS = 10_000;

/** VdoCipher ids are 32 lowercase hex characters. Checked before any URL is built. */
export function isVdoCipherId(id: string): boolean {
  return /^[a-f0-9]{32}$/.test(id);
}

function assertId(id: string): string {
  if (!isVdoCipherId(id)) throw new VideoProviderError('Invalid video id', 'BAD_ID');
  return id;
}

/** VdoCipher statuses: PRE-Upload, Queued, Processing, ready, Error … (case varies). */
export function mapVdoStatus(raw: unknown): ProviderVideoStatus {
  const s = String(raw ?? '').toLowerCase();
  if (s === 'ready') return 'READY';
  if (s === 'pre-upload' || s === 'preupload') return 'UPLOADING';
  if (s.includes('error') || s.includes('fail')) return 'FAILED';
  return 'PROCESSING';
}

/**
 * The moving watermark: VdoCipher "rtext" (random-position text), semi-
 * transparent, repositioned every few seconds so it cannot be cropped out.
 */
export function watermarkAnnotation(label: string): string {
  return JSON.stringify([
    { type: 'rtext', text: label, alpha: '0.45', color: '0xFFFFFF', size: '15', interval: '5000' },
  ]);
}

type FetchLike = typeof fetch;

export function createVdoCipherProvider(apiSecret: string, fetchImpl: FetchLike = fetch): VideoProvider {
  async function call(path: string, init: RequestInit = {}): Promise<Response> {
    let res: Response;
    try {
      res = await fetchImpl(`${API_BASE}${path}`, {
        ...init,
        headers: {
          Authorization: `Apisecret ${apiSecret}`,
          Accept: 'application/json',
          ...(typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
          ...(init.headers ?? {}),
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: 'no-store',
      });
    } catch (err) {
      throw new VideoProviderError(`VdoCipher unreachable: ${String(err)}`, 'UPSTREAM');
    }
    return res;
  }

  async function json<T>(res: Response, what: string): Promise<T> {
    if (!res.ok) {
      // Never echo the body: it may contain request details.
      throw new VideoProviderError(`VdoCipher ${what} failed (${res.status})`, res.status === 404 ? 'NOT_FOUND' : 'UPSTREAM');
    }
    return (await res.json()) as T;
  }

  return {
    code: 'vdocipher',

    async createUpload({ title }): Promise<UploadTicket> {
      const safeTitle = title.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 120) || 'Untitled';
      const res = await call(`/videos?title=${encodeURIComponent(safeTitle)}`, { method: 'PUT' });
      const body = await json<{ videoId?: string; clientPayload?: Record<string, string> }>(res, 'upload');
      const p = body.clientPayload;
      if (!body.videoId || !p?.uploadLink) throw new VideoProviderError('VdoCipher upload: unexpected response', 'UPSTREAM');
      return {
        videoId: assertId(body.videoId),
        url: p.uploadLink,
        fields: {
          policy: p.policy ?? '',
          key: p.key ?? '',
          'x-amz-signature': p['x-amz-signature'] ?? '',
          'x-amz-algorithm': p['x-amz-algorithm'] ?? '',
          'x-amz-date': p['x-amz-date'] ?? '',
          'x-amz-credential': p['x-amz-credential'] ?? '',
          success_action_status: '201',
          success_action_redirect: '',
        },
        fileField: 'file',
      };
    },

    async getVideo(videoId): Promise<ProviderVideo | null> {
      const res = await call(`/videos/${assertId(videoId)}`);
      if (res.status === 404) return null;
      const v = await json<{ id?: string; status?: string; length?: number; poster?: string; posters?: { url?: string }[] }>(res, 'video');
      return {
        videoId,
        status: mapVdoStatus(v.status),
        durationSec: typeof v.length === 'number' && v.length > 0 ? Math.round(v.length) : null,
        posterUrl: v.poster ?? v.posters?.[0]?.url ?? null,
      };
    },

    async createPlaybackToken({ videoId, watermark, ttlSec }): Promise<PlaybackToken> {
      const res = await call(`/videos/${assertId(videoId)}/otp`, {
        method: 'POST',
        body: JSON.stringify({ ttl: ttlSec, annotate: watermarkAnnotation(watermark) }),
      });
      const body = await json<{ otp?: string; playbackInfo?: string }>(res, 'otp');
      if (!body.otp || !body.playbackInfo) throw new VideoProviderError('VdoCipher otp: unexpected response', 'UPSTREAM');
      return { otp: body.otp, playbackInfo: body.playbackInfo, expiresAt: new Date(Date.now() + ttlSec * 1000).toISOString() };
    },

    async deleteVideo(videoId): Promise<void> {
      const res = await call(`/videos?videos=${assertId(videoId)}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 404) throw new VideoProviderError(`VdoCipher delete failed (${res.status})`, 'UPSTREAM');
    },

    // docs: vdocipher.com/docs/server/videomanagement/files/upload-captions (multipart, `file`, ?language=)
    async addSubtitle({ videoId, language, vtt }): Promise<string> {
      const form = new FormData();
      form.append('file', new Blob([vtt], { type: 'text/vtt' }), `${language}.vtt`);
      // No JSON content type here: fetch sets the multipart boundary itself.
      const res = await call(`/videos/${assertId(videoId)}/files/?language=${language}`, { method: 'POST', body: form, headers: {} });
      const body = await json<{ id?: number | string }>(res, 'subtitle upload');
      if (body.id === undefined || body.id === null) throw new VideoProviderError('VdoCipher subtitle: unexpected response', 'UPSTREAM');
      return String(body.id);
    },

    async deleteSubtitle({ videoId, fileId }): Promise<void> {
      if (!/^\d{1,20}$/.test(fileId)) throw new VideoProviderError('Bad file id', 'BAD_ID');
      const res = await call(`/videos/${assertId(videoId)}/files/${fileId}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 404) throw new VideoProviderError(`VdoCipher subtitle delete failed (${res.status})`, 'UPSTREAM');
    },
  };
}
