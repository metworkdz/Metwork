/**
 * Copilot knowledge base — THE shape of the index and the pure functions
 * that build and search it (Metwork 2.0 phase 5).
 *
 * The source is the `tax documents/` folder (codes, finance laws, G-series
 * forms). `scripts/kb-sync.ts` and the admin upload both extract page text
 * with `extract.ts`, cut it here into article-sized chunks, and search runs
 * BM25 over those chunks in memory. No embeddings: legal questions name
 * articles, forms and terms, which lexical search finds well — and Claude
 * rewrites every question (Arabic included) into French search terms first.
 *
 * Pure, no I/O: safe to unit-test and to run in the sync script.
 */
import { createHash } from 'node:crypto';
import { tokenize } from '@/lib/text-search';

export { tokenize };

export interface KbDocument {
  /** Stable id derived from the path ("2026/code-des-impots-directs…"). */
  id: string;
  /** Path relative to `tax documents/`, or "admin/<file>" for uploads. */
  path: string;
  title: string;
  category: KbCategory;
  /** The year the text is in force for, from the file name; null if none. */
  year: number | null;
  pages: number;
  chunks: number;
  origin: 'SYNC' | 'ADMIN';
  addedAt: string;
  sha256: string;
}

export const KB_CATEGORIES = ['CODE', 'FINANCE_LAW', 'FORM', 'COMMERCE', 'ACCOUNTING', 'OTHER'] as const;
export type KbCategory = (typeof KB_CATEGORIES)[number];

export interface KbChunk {
  /** `${docId}#${n}` — what a citation points back to. */
  id: string;
  docId: string;
  /** 1-based page where the chunk starts. */
  page: number;
  /** "Art. 282 sexies", when the chunk starts on an article. */
  article: string | null;
  text: string;
}

export interface KbIndex {
  version: 1;
  builtAt: string;
  documents: KbDocument[];
  chunks: KbChunk[];
}

/* ─────────────────────────── Building ─────────────────────────── */

const TARGET_CHARS = 1800;
/** Below this, a piece is a fragment (a running header, a title) and joins the next. */
const FRAGMENT_CHARS = 80;
/** Pages with less text than this are scans: nothing to index. */
export const MIN_TEXT_PER_DOCUMENT = 200;

export function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\.pdf$/, '')
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120);
}

export function sha256(buf: Uint8Array): string {
  return createHash('sha256').update(buf).digest('hex');
}

/** Metadata guessed from where the file sits and what it is called. */
export function describeDocument(relPath: string): Pick<KbDocument, 'id' | 'path' | 'title' | 'category' | 'year'> {
  const file = relPath.split('/').pop() ?? relPath;
  const folder = relPath.includes('/') ? relPath.split('/')[0]! : '';
  const title = file.replace(/\.pdf$/i, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  const lower = `${folder}/${file}`.toLowerCase();
  const category: KbCategory =
    /formulaire|gn ?°|g ?n°|^g ?\d|notice|g50|g29|cn°|c n°/.test(lower) && !lower.includes('code') ? 'FORM'
    : lower.includes('loi') && lower.includes('financ') ? 'FINANCE_LAW'
    : lower.includes('code de commerce') ? 'COMMERCE'
    : lower.includes('comptable') || lower.includes('scf') ? 'ACCOUNTING'
    : lower.includes('code') ? 'CODE'
    : 'OTHER';
  const years = [...file.matchAll(/(?:19|20)\d{2}/g)].map((m) => Number(m[0]));
  const folderYear = /^(?:19|20)\d{2}$/.test(folder) ? Number(folder) : null;
  return { id: slugify(relPath), path: relPath, title, category, year: years.length ? Math.max(...years) : folderYear };
}

// "Art. 14 −", "Art 22 -", "Article 282 sexies :", "Art. 51."
const ARTICLE_RE = /(?:^|\n)\s*(Art(?:icle)?\.?\s*\d+(?:\s*(?:bis|ter|quater|quinquies|sexies|septies|octies|nonies|decies))?(?:\s*-\s*\d+)?)\s*[.:\-−–]/gi;

function clean(text: string): string {
  return text
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Split a too-long piece on paragraph, then sentence, boundaries. */
function splitLong(text: string): string[] {
  if (text.length <= TARGET_CHARS * 1.4) return [text];
  const out: string[] = [];
  let cur = '';
  for (const para of text.split(/\n/)) {
    const parts = para.length > TARGET_CHARS ? para.split(/(?<=[.;:])\s+/) : [para];
    for (const p of parts) {
      if (cur && cur.length + p.length + 1 > TARGET_CHARS) {
        out.push(cur);
        cur = '';
      }
      cur = cur ? `${cur}\n${p}` : p;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Cut a document's pages into chunks that start on article boundaries when
 * the text has articles, else on paragraphs. Each chunk keeps the page it
 * starts on and the article it starts with, for the citation.
 */
export function chunkPages(docId: string, pages: string[]): KbChunk[] {
  const starts: number[] = [];
  let full = '';
  for (const p of pages) {
    starts.push(full.length);
    full += `${clean(p)}\n`;
  }
  const pageAt = (offset: number) => {
    let lo = 0;
    for (let i = 0; i < starts.length; i++) if (starts[i]! <= offset) lo = i;
    return lo + 1;
  };

  const cuts = [0];
  for (const m of full.matchAll(ARTICLE_RE)) {
    const at = m.index! + (m[0].startsWith('\n') ? 1 : 0);
    if (at > 0) cuts.push(at);
  }
  cuts.push(full.length);

  // A heading before an article, or a fragment, joins the next piece and
  // takes its article: every article stays its own chunk with its label.
  const ARTICLE_LABEL = /^(Art(?:icle)?\.?\s*\d+(?:\s*(?:bis|ter|quater|quinquies|sexies|septies|octies|nonies|decies))?)/i;
  const segments: { at: number; text: string; article: string | null }[] = [];
  let pending: { at: number; text: string } | null = null;
  for (let i = 0; i < cuts.length - 1; i++) {
    const text = full.slice(cuts[i], cuts[i + 1]).trim();
    if (!text) continue;
    const article = ARTICLE_LABEL.exec(text)?.[1] ?? null;
    const isLast = i === cuts.length - 2;
    if (!article && text.length < FRAGMENT_CHARS * 4 && !isLast && i === 0) {
      // The preamble (titles) before the first article.
      pending = { at: cuts[i]!, text };
      continue;
    }
    if (pending) {
      segments.push({ at: pending.at, text: `${pending.text}\n${text}`, article });
      pending = null;
    } else if (text.length < FRAGMENT_CHARS && segments.length) {
      segments[segments.length - 1]!.text += `\n${text}`;
    } else {
      segments.push({ at: cuts[i]!, text, article });
    }
  }
  if (pending) segments.push({ ...pending, article: null });

  const chunks: KbChunk[] = [];
  for (const seg of segments) {
    const article = seg.article;
    let offset = seg.at;
    for (const piece of splitLong(seg.text)) {
      chunks.push({
        id: `${docId}#${chunks.length}`,
        docId,
        page: pageAt(offset),
        article: article ? article.replace(/^Article/i, 'Art.').replace(/^Art\.?\s*/i, 'Art. ').replace(/\s+/g, ' ') : null,
        text: piece,
      });
      offset += piece.length;
    }
  }
  return chunks;
}

/** Add or replace one document in an index (same id = new version). */
export function upsertDocument(index: KbIndex, doc: KbDocument, chunks: KbChunk[]): KbIndex {
  return {
    version: 1,
    builtAt: new Date().toISOString(),
    documents: [...index.documents.filter((d) => d.id !== doc.id), doc].sort((a, b) => a.path.localeCompare(b.path)),
    chunks: [...index.chunks.filter((c) => c.docId !== doc.id), ...chunks],
  };
}

export function removeDocument(index: KbIndex, docId: string): KbIndex {
  return {
    version: 1,
    builtAt: new Date().toISOString(),
    documents: index.documents.filter((d) => d.id !== docId),
    chunks: index.chunks.filter((c) => c.docId !== docId),
  };
}

/* ─────────────────────────── Search (BM25) ─────────────────────────── */

export interface SearchIndex {
  chunks: KbChunk[];
  docs: Map<string, KbDocument>;
  tf: Map<string, number>[];
  len: number[];
  df: Map<string, number>;
  avgLen: number;
}

export function buildSearchIndex(index: KbIndex): SearchIndex {
  const tf: Map<string, number>[] = [];
  const len: number[] = [];
  const df = new Map<string, number>();
  for (const c of index.chunks) {
    const terms = tokenize(`${c.article ?? ''} ${c.text}`);
    const m = new Map<string, number>();
    for (const t of terms) m.set(t, (m.get(t) ?? 0) + 1);
    for (const t of m.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    tf.push(m);
    len.push(terms.length);
  }
  const avgLen = len.reduce((a, b) => a + b, 0) / Math.max(1, len.length);
  return { chunks: index.chunks, docs: new Map(index.documents.map((d) => [d.id, d])), tf, len, df, avgLen };
}

const K1 = 1.4;
const B = 0.75;

/**
 * Top chunks for a query. Newer texts get a small boost so a 2026 code
 * outranks a 2018 finance law saying the same words — the newest text is the
 * one in force.
 */
export function search(idx: SearchIndex, query: string, k = 8): { chunk: KbChunk; doc: KbDocument; score: number }[] {
  const terms = [...new Set(tokenize(query))];
  if (!terms.length) return [];
  const n = idx.chunks.length;
  const newest = Math.max(0, ...[...idx.docs.values()].map((d) => d.year ?? 0));
  const scored: { i: number; score: number }[] = [];
  for (let i = 0; i < n; i++) {
    const m = idx.tf[i]!;
    let s = 0;
    for (const t of terms) {
      const f = m.get(t);
      if (!f) continue;
      const df = idx.df.get(t) ?? 0;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      s += idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * idx.len[i]!) / idx.avgLen)));
    }
    if (s > 0) {
      const year = idx.docs.get(idx.chunks[i]!.docId)?.year ?? null;
      const age = year && newest ? Math.max(0, newest - year) : 4;
      // Up to +30 % for the newest texts, fading over four years.
      scored.push({ i, score: s * (1 + (0.3 * Math.max(0, 4 - age)) / 4) });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  const out: { chunk: KbChunk; doc: KbDocument; score: number }[] = [];
  const perDoc = new Map<string, number>();
  for (const { i, score } of scored) {
    const chunk = idx.chunks[i]!;
    // At most 3 passages from one document, so one long code can't crowd out the rest.
    const seen = perDoc.get(chunk.docId) ?? 0;
    if (seen >= 3) continue;
    perDoc.set(chunk.docId, seen + 1);
    out.push({ chunk, doc: idx.docs.get(chunk.docId)!, score });
    if (out.length >= k) break;
  }
  return out;
}
