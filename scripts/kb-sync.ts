/**
 * Build the copilot knowledge base from the `tax documents/` folder.
 *
 *   npm run kb:sync                 → build, write .kb/index.json.gz, print a report
 *   npm run kb:sync -- --upload     → also publish it (Cloudinary + pointer in the store)
 *
 * Run it after adding or replacing a file in the folder (a new finance law,
 * a new form). Unchanged files (same SHA-256) are reused from the live index
 * instead of re-extracted. Documents uploaded from the admin page are kept;
 * pass --prune to drop every document that is not in the folder.
 *
 * Scanned PDFs (no text layer) are reported and skipped — they need OCR.
 *
 * With --upload this writes to the store `.env.local` points at (production),
 * unless USE_LOCAL_DB=true.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadScriptEnv } from './_env';

const UPLOAD = process.argv.includes('--upload');
const PRUNE = process.argv.includes('--prune');
const ROOT = path.resolve(process.cwd(), 'tax documents');

/** Cloudinary credentials for --upload (the store vars come from loadScriptEnv). */
function loadCloudinaryEnv() {
  const file = path.resolve(process.cwd(), '.env.local');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^(CLOUDINARY_[A-Z_]+)=(.*)$/);
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.trim().replace(/^['"]|['"]$/g, '');
  }
}

function listPdfs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listPdfs(full));
    else if (entry.name.toLowerCase().endsWith('.pdf')) out.push(full);
  }
  return out.sort();
}

async function main() {
  const target = loadScriptEnv();
  loadCloudinaryEnv();
  // Imported after the env is set: these pull in the store.
  const { indexPdf } = await import('../src/server/copilot/extract');
  const { sha256, upsertDocument, removeDocument, describeDocument } = await import('../src/server/copilot/kb');
  const { currentIndex, encodeIndex, publishIndex, LOCAL_INDEX_PATH, EMPTY_INDEX } = await import('../src/server/copilot/kb-store');

  if (!fs.existsSync(ROOT)) {
    console.error(`✘ ${ROOT} not found`);
    process.exit(1);
  }
  console.log(UPLOAD ? `⚠  PUBLISH MODE (--upload) → ${target.label}` : '🔎 Local build only (add --upload to publish)');

  let live = EMPTY_INDEX;
  try {
    live = await currentIndex();
  } catch (err) {
    console.warn('⚠  Could not read the live index, rebuilding everything:', String(err));
  }
  const liveById = new Map(live.documents.map((d) => [d.id, d]));
  let index = live;
  const seen = new Set<string>();
  const skipped: string[] = [];
  let reused = 0;
  let extracted = 0;

  for (const file of listPdfs(ROOT)) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    const buf = new Uint8Array(fs.readFileSync(file));
    const id = describeDocument(rel).id;
    seen.add(id);
    if (liveById.get(id)?.sha256 === sha256(buf)) { reused++; continue; }
    const result = await indexPdf(rel, buf, 'SYNC');
    if (!result.ok) {
      skipped.push(`${rel} (${result.pages} pages, no text layer)`);
      index = removeDocument(index, id);
      continue;
    }
    index = upsertDocument(index, result.doc, result.chunks);
    extracted++;
    console.log(`  + ${rel}: ${result.doc.pages} pages → ${result.chunks.length} chunks`);
  }

  for (const d of index.documents) {
    if (seen.has(d.id)) continue;
    if (d.origin === 'SYNC' || PRUNE) {
      index = removeDocument(index, d.id);
      console.log(`  − ${d.path} (no longer in the folder)`);
    }
  }

  // The Code de commerce ships both whole and per book: drop exact duplicates.
  const texts = new Set<string>();
  const before = index.chunks.length;
  const chunks = index.chunks.filter((c) => {
    const key = c.text.replace(/\s+/g, ' ').trim();
    if (texts.has(key)) return false;
    texts.add(key);
    return true;
  });
  index = { ...index, chunks, documents: index.documents.map((d) => ({ ...d, chunks: chunks.filter((c) => c.docId === d.id).length })) };

  fs.mkdirSync(path.dirname(LOCAL_INDEX_PATH), { recursive: true });
  const gz = encodeIndex(index);
  fs.writeFileSync(LOCAL_INDEX_PATH, gz);

  console.log(`\n✔ ${index.documents.length} documents, ${index.chunks.length} chunks (${before - chunks.length} duplicates dropped)`);
  console.log(`  extracted ${extracted}, unchanged ${reused}, ${(gz.length / 1024 / 1024).toFixed(1)} MB gzipped → ${path.relative(process.cwd(), LOCAL_INDEX_PATH)}`);
  if (skipped.length) {
    console.log(`\n⚠  ${skipped.length} scanned PDFs skipped (need OCR):`);
    for (const s of skipped) console.log(`   · ${s}`);
  }

  if (UPLOAD) {
    const pointer = await publishIndex(index);
    console.log(`\n✔ Published ${pointer.publicId} (${(pointer.bytes / 1024 / 1024).toFixed(1)} MB) — the copilot uses it now.`);
  }
}

main().catch((err) => {
  console.error('✘ kb:sync failed:', err);
  process.exit(1);
});
