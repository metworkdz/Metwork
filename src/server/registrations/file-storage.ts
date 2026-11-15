/**
 * Where the bytes behind a `FILE` registration answer live.
 *
 *   • Cloudinary configured  → private (`authenticated`) raw assets. The browser
 *     uploads straight to Cloudinary with a signature we mint; nothing readable
 *     is ever reachable by URL.
 *   • Not configured, dev    → a git-ignored `.local-uploads/` folder, so the
 *     feature can be developed and tested without credentials. It sits OUTSIDE
 *     `public/` on purpose: a private file must never be a static asset.
 *   • Not configured, prod   → unavailable. Refusing is correct; silently
 *     writing to a read-only (or, worse, public) disk is not.
 *
 * Callers pass a public_id that has ALREADY been matched against
 * `isRegistrationFilePublicId`; the local backend still refuses anything that
 * would resolve outside its folder, as defence in depth.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  destroyAuthenticatedRaw,
  getAuthenticatedRawResource,
  isConfigured,
  readAuthenticatedRawHead,
} from '@/lib/cloudinary';

export type StorageMode = 'cloudinary' | 'local' | 'unavailable';

export function registrationFileStorageMode(): StorageMode {
  if (isConfigured()) return 'cloudinary';
  return process.env.NODE_ENV === 'production' ? 'unavailable' : 'local';
}

function localRoot(): string {
  return path.resolve(process.cwd(), process.env.LOCAL_UPLOADS_DIR ?? '.local-uploads');
}

function localPath(publicId: string): string {
  const root = localRoot();
  const full = path.resolve(root, publicId);
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new Error('Refusing a storage path outside the uploads folder');
  }
  return full;
}

/** True byte size of a stored file, or null when it does not exist. */
export async function statRegistrationFile(publicId: string): Promise<{ bytes: number } | null> {
  if (registrationFileStorageMode() === 'cloudinary') {
    return getAuthenticatedRawResource(publicId);
  }
  try {
    const st = await fs.stat(localPath(publicId));
    return { bytes: st.size };
  } catch {
    return null;
  }
}

/** The first `length` bytes of a stored file, or null when it cannot be read. */
export async function headRegistrationFile(
  publicId: string,
  length: number,
): Promise<Buffer | null> {
  if (registrationFileStorageMode() === 'cloudinary') {
    return readAuthenticatedRawHead(publicId, length);
  }
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(localPath(publicId), 'r');
    const buf = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buf, 0, length, 0);
    return buf.subarray(0, bytesRead);
  } catch {
    return null;
  } finally {
    await handle?.close();
  }
}

/** Best-effort delete. Never throws: it runs on cleanup paths that must not fail a request. */
export async function removeRegistrationFile(publicId: string): Promise<void> {
  try {
    if (registrationFileStorageMode() === 'cloudinary') {
      await destroyAuthenticatedRaw(publicId);
    } else {
      await fs.rm(localPath(publicId), { force: true });
    }
  } catch (err) {
    console.error('[registration-files] Could not delete', publicId, err);
  }
}

/** Dev-only: write an uploaded file to the local folder. */
export async function writeLocalRegistrationFile(publicId: string, buffer: Buffer): Promise<void> {
  if (registrationFileStorageMode() !== 'local') {
    throw new Error('Local registration-file storage is disabled');
  }
  const full = localPath(publicId);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, buffer);
}
