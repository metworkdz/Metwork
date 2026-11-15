/**
 * Browser side of attaching a file to a registration answer.
 *
 *   1. check type + size here, before any bytes move
 *   2. POST /api/registrations/file-signature  → a signature for THIS question
 *   3. send the file straight to Cloudinary as a private asset (never through
 *      our serverless function — Vercel rejects bodies over 4.5 MB), with
 *      progress; or, in local dev with no Cloudinary, to /api/registrations/file-upload
 *   4. hand back the public_id, which becomes the answer
 *
 * Nothing here is trusted by the server: it re-verifies the file by its bytes
 * when the form is submitted (see `@/server/registrations/files`). These checks
 * exist so a visitor hears "that's too big" in a second rather than after the
 * upload, and so Cloudinary rejections never surface as a bare "Failed to fetch".
 *
 * Dependency-free (no React, no SDK) so it can be unit-tested in node: the two
 * transports are injectable.
 */
import {
  MAX_REGISTRATION_FILE_BYTES,
  REGISTRATION_FILE_MIMES,
  type RegistrationFileMime,
} from '@/lib/upload-limits';

export type RegistrationFileUploadErrorCode =
  | 'TYPE'
  | 'SIZE'
  | 'EMPTY'
  | 'NETWORK'
  | 'SERVICE'
  | 'RATE_LIMITED'
  | 'UNAVAILABLE'
  | 'CANCELLED'
  | 'GENERIC';

export class RegistrationFileUploadError extends Error {
  constructor(public readonly code: RegistrationFileUploadErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'RegistrationFileUploadError';
  }
}

/**
 * The type to treat a picked file as. Some phones and file managers hand over
 * an empty `type` for a perfectly good PDF, so fall back to the extension — the
 * server checks the real bytes anyway.
 */
export function effectiveMime(file: Pick<File, 'type' | 'name'>): RegistrationFileMime | null {
  if ((REGISTRATION_FILE_MIMES as readonly string[]).includes(file.type)) {
    return file.type as RegistrationFileMime;
  }
  if (file.type && file.type !== 'application/octet-stream') return null;
  const ext = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase();
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  return null;
}

/** Throws a typed error if the file can be refused without asking the server. */
export function checkRegistrationFile(file: Pick<File, 'type' | 'name' | 'size'>): RegistrationFileMime {
  if (file.size === 0) throw new RegistrationFileUploadError('EMPTY');
  const mime = effectiveMime(file);
  if (!mime) throw new RegistrationFileUploadError('TYPE');
  if (file.size > MAX_REGISTRATION_FILE_BYTES) throw new RegistrationFileUploadError('SIZE');
  return mime;
}

/** "4.2 MB", "310 KB" — for the file card. */
export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/* ─────────────────────────── Transports ─────────────────────────── */

export interface UploadResponse {
  status: number;
  body: unknown;
}

export interface UploadDeps {
  /** JSON POST to our own API. */
  postJson: (url: string, body: unknown, signal?: AbortSignal) => Promise<UploadResponse>;
  /** Multipart POST with upload progress (0..1). Rejects on a network failure. */
  postForm: (
    url: string,
    form: FormData,
    onProgress: (fraction: number) => void,
    signal?: AbortSignal,
  ) => Promise<UploadResponse>;
}

export const browserDeps: UploadDeps = {
  async postJson(url, body, signal) {
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  },
  // fetch() cannot report upload progress, so a file this size goes by XHR.
  postForm(url, form, onProgress, signal) {
    return new Promise<UploadResponse>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(e.loaded / e.total);
      };
      xhr.onload = () => {
        let body: unknown = {};
        try { body = JSON.parse(xhr.responseText); } catch { /* non-JSON body */ }
        resolve({ status: xhr.status, body });
      };
      xhr.onerror = () => reject(new Error('network'));
      xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'));
      signal?.addEventListener('abort', () => xhr.abort());
      xhr.send(form);
    });
  },
};

/* ─────────────────────────── The upload ─────────────────────────── */

export interface UploadArgs {
  entityType: 'PROGRAM' | 'EVENT';
  entityId: string;
  fieldId: string;
  file: File;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

interface SignatureBody {
  mode?: 'direct' | 'proxy';
  uploadUrl?: string;
  apiKey?: string;
  timestamp?: number;
  publicId?: string;
  signature?: string;
  type?: string;
  error?: { code?: string };
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

/** Our API's refusal → the error a visitor can act on. */
function fromApiStatus(status: number, code: string | undefined): RegistrationFileUploadError {
  if (status === 429) return new RegistrationFileUploadError('RATE_LIMITED');
  if (status === 415 || code === 'UNSUPPORTED_FILE_TYPE') return new RegistrationFileUploadError('TYPE');
  if (status === 413 || code === 'FILE_TOO_LARGE') return new RegistrationFileUploadError('SIZE');
  if (status === 503) return new RegistrationFileUploadError('UNAVAILABLE');
  return new RegistrationFileUploadError('GENERIC');
}

/** Uploads one file and resolves with the public_id to submit as the answer. */
export async function uploadRegistrationFile(
  args: UploadArgs,
  deps: UploadDeps = browserDeps,
): Promise<{ publicId: string }> {
  const { entityType, entityId, fieldId, file, signal } = args;
  const onProgress = args.onProgress ?? (() => undefined);
  const mime = checkRegistrationFile(file);

  try {
    const sig = await deps.postJson(
      '/api/registrations/file-signature',
      { entityType, entityId, fieldId, size: file.size, mimeType: mime },
      signal,
    );
    const sigBody = sig.body as SignatureBody;
    if (sig.status < 200 || sig.status >= 300) throw fromApiStatus(sig.status, sigBody.error?.code);

    if (sigBody.mode === 'proxy') {
      // Local dev only: no Cloudinary, so the file goes through our own route.
      const fd = new FormData();
      fd.append('entityType', entityType);
      fd.append('entityId', entityId);
      fd.append('fieldId', fieldId);
      fd.append('file', file);
      const res = await deps.postForm('/api/registrations/file-upload', fd, onProgress, signal);
      const body = res.body as { publicId?: string; error?: { code?: string } };
      if (res.status < 200 || res.status >= 300 || !body.publicId) {
        throw fromApiStatus(res.status, body.error?.code);
      }
      return { publicId: body.publicId };
    }

    if (
      sigBody.mode !== 'direct' || !sigBody.uploadUrl || !sigBody.apiKey ||
      !sigBody.timestamp || !sigBody.publicId || !sigBody.signature
    ) {
      throw new RegistrationFileUploadError('GENERIC');
    }

    const fd = new FormData();
    // Extensionless on purpose: Cloudinary appends a raw file's extension to the
    // public_id, which would no longer match the one we signed and verify.
    fd.append('file', file, 'registration-file');
    fd.append('api_key', sigBody.apiKey);
    fd.append('timestamp', String(sigBody.timestamp));
    fd.append('public_id', sigBody.publicId);
    fd.append('signature', sigBody.signature);
    // Part of what was signed: the upload is private, and cannot be made public
    // by leaving this out.
    if (sigBody.type) fd.append('type', sigBody.type);

    const up = await deps.postForm(sigBody.uploadUrl, fd, onProgress, signal);
    if (up.status < 200 || up.status >= 300) {
      console.error('[registration-file] Cloudinary rejected the upload:', up.status, up.body);
      throw new RegistrationFileUploadError('SERVICE');
    }
    onProgress(1);
    return { publicId: sigBody.publicId };
  } catch (err) {
    if (err instanceof RegistrationFileUploadError) throw err;
    if (isAbort(err) || signal?.aborted) throw new RegistrationFileUploadError('CANCELLED');
    // A transport that rejected: offline, connection dropped, blocked.
    throw new RegistrationFileUploadError('NETWORK');
  }
}
