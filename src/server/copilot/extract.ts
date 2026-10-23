/**
 * PDF → page texts, for the copilot knowledge base. Shared by
 * `scripts/kb-sync.ts` and the admin upload so both index the same way.
 */
import { extractText, getDocumentProxy } from 'unpdf';
import { chunkPages, describeDocument, MIN_TEXT_PER_DOCUMENT, sha256, type KbChunk, type KbDocument } from '@/server/copilot/kb';

export async function extractPdfPages(buf: Uint8Array): Promise<string[]> {
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(pdf, { mergePages: false });
  return text;
}

export type IndexedPdf =
  | { ok: true; doc: KbDocument; chunks: KbChunk[] }
  /** A scan (no text layer): nothing to index without OCR. */
  | { ok: false; reason: 'NO_TEXT'; pages: number };

/** Extract and chunk one PDF, ready for `upsertDocument`. */
export async function indexPdf(relPath: string, buf: Uint8Array, origin: KbDocument['origin']): Promise<IndexedPdf> {
  const pages = await extractPdfPages(buf);
  const chars = pages.reduce((s, p) => s + p.trim().length, 0);
  if (chars < MIN_TEXT_PER_DOCUMENT) return { ok: false, reason: 'NO_TEXT', pages: pages.length };
  const meta = describeDocument(relPath);
  const chunks = chunkPages(meta.id, pages);
  return {
    ok: true,
    doc: { ...meta, pages: pages.length, chunks: chunks.length, origin, addedAt: new Date().toISOString(), sha256: sha256(buf) },
    chunks,
  };
}
