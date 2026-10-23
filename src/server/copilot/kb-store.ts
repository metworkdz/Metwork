/**
 * Where the copilot index lives and how it is loaded.
 *
 * The index (~6 M characters of law) is far too big for the JSONB store, so
 * it is a gzipped JSON file kept as a PRIVATE Cloudinary asset; the store
 * only holds a pointer (`copilotKb`). A rebuild uploads a new file, swaps the
 * pointer, then deletes the old file — readers never see a half-written one.
 *
 * Without a pointer (local dev, before the first sync) the index is read from
 * `.kb/index.json.gz`, which `npm run kb:sync` always writes.
 *
 * Loaded once per server instance and cached by pointer id.
 */
import { gunzipSync, gzipSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { db, type CopilotKbPointer } from '@/server/db/store';
import {
  destroyAuthenticatedRaw,
  isConfigured as isCloudinaryConfigured,
  signedRawDownloadUrl,
  uploadAuthenticatedRaw,
} from '@/lib/cloudinary';
import { buildSearchIndex, type KbIndex, type SearchIndex } from '@/server/copilot/kb';

export const KB_FOLDER = 'metwork/copilot-kb';
export const LOCAL_INDEX_PATH = path.join(process.cwd(), '.kb', 'index.json.gz');

export const EMPTY_INDEX: KbIndex = { version: 1, builtAt: new Date(0).toISOString(), documents: [], chunks: [] };

let cache: { key: string; index: KbIndex; search: SearchIndex } | null = null;

export function encodeIndex(index: KbIndex): Buffer {
  return gzipSync(Buffer.from(JSON.stringify(index)));
}

function decodeIndex(buf: Buffer): KbIndex {
  const parsed = JSON.parse(gunzipSync(buf).toString('utf8')) as KbIndex;
  if (parsed.version !== 1 || !Array.isArray(parsed.chunks) || !Array.isArray(parsed.documents)) {
    throw new Error('Unrecognised copilot index');
  }
  return parsed;
}

async function fetchIndex(pointer: CopilotKbPointer): Promise<KbIndex> {
  const res = await fetch(signedRawDownloadUrl(pointer.publicId), { cache: 'no-store' });
  if (!res.ok) throw new Error(`Copilot index download failed (${res.status})`);
  return decodeIndex(Buffer.from(await res.arrayBuffer()));
}

/** The live index, or null when none has been built yet. */
export async function loadKb(): Promise<{ index: KbIndex; search: SearchIndex } | null> {
  const pointer = (await db.read()).copilotKb ?? null;
  const key = pointer?.publicId ?? 'local';
  if (cache && (cache.key === key || cache.key === 'test')) return cache;
  let index: KbIndex;
  if (pointer) {
    index = await fetchIndex(pointer);
  } else {
    try {
      index = decodeIndex(await readFile(LOCAL_INDEX_PATH));
    } catch {
      return null;
    }
  }
  cache = { key, index, search: buildSearchIndex(index) };
  return cache;
}

/** The index to edit: the live one, or an empty one before the first build. */
export async function currentIndex(): Promise<KbIndex> {
  return (await loadKb())?.index ?? EMPTY_INDEX;
}

export class KbConflictError extends Error {}

/**
 * Upload a new index and make it live. Returns the new pointer.
 * `basedOn` is the pointer the edit started from: if another rebuild went
 * live meanwhile, the swap is refused (KbConflictError) instead of silently
 * dropping that rebuild's documents.
 */
export async function publishIndex(index: KbIndex, basedOn?: string | null): Promise<CopilotKbPointer> {
  if (!isCloudinaryConfigured()) throw new Error('Cloudinary is not configured');
  const buf = encodeIndex(index);
  const { publicId, bytes } = await uploadAuthenticatedRaw(buf, {
    folder: KB_FOLDER,
    publicId: `index-${Date.now()}`,
  });
  const pointer: CopilotKbPointer = {
    publicId,
    builtAt: index.builtAt,
    documents: index.documents.length,
    chunks: index.chunks.length,
    bytes,
  };
  const previous = await db.update((d) => {
    const old = d.copilotKb?.publicId ?? null;
    if (basedOn !== undefined && old !== basedOn) return { conflict: true as const };
    d.copilotKb = pointer;
    return { conflict: false as const, old };
  });
  if (previous.conflict) {
    await destroyAuthenticatedRaw(publicId).catch(() => undefined);
    throw new KbConflictError('The knowledge base changed meanwhile');
  }
  cache = { key: publicId, index, search: buildSearchIndex(index) };
  if (previous.old) await destroyAuthenticatedRaw(previous.old).catch(() => undefined);
  return pointer;
}

/** Tests only. */
export function resetKbCacheForTests(index: KbIndex | null = null): void {
  cache = index ? { key: 'test', index, search: buildSearchIndex(index) } : null;
}
