/**
 * Full snapshot of the Supabase JSONB store (`app_state` row id = 1) → a
 * timestamped local file under `backups/`.
 *
 * READ-ONLY against Supabase. Never mutates the store. Re-runnable (each run
 * writes a new timestamped file). This is the safety net taken BEFORE the
 * financial reset (scripts/reset-financials.ts).
 *
 * Creds are read from /Users/macbookpro/Downloads/metwork/.env.local, mirroring
 * scripts/pull-mentors-from-supabase.ts.
 *
 * Run: npx tsx scripts/backup-app-state.ts
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createClient } from '@supabase/supabase-js';

// ── Load real Supabase creds from the repo's .env.local ───────────────────
const MAIN_ENV = path.resolve(process.cwd(), '.env.local');
if (!fs.existsSync(MAIN_ENV)) {
  console.error(`✘ ${MAIN_ENV} not found — no Supabase creds available.`);
  process.exit(1);
}
const envContent = fs.readFileSync(MAIN_ENV, 'utf8');
const envMap: Record<string, string> = {};
for (const line of envContent.split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) envMap[m[1]!] = m[2]!.trim().replace(/^['"]|['"]$/g, '');
}
const SUPABASE_URL = envMap.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = envMap.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('✘ SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing from .env.local');
  process.exit(1);
}
if (SUPABASE_URL.includes('placeholder')) {
  console.error('✘ .env.local still has a placeholder Supabase URL — refusing to back up.');
  process.exit(1);
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

async function main() {
  const host = SUPABASE_URL!.replace(/^https:\/\//, '').slice(0, 30);
  console.log(`→ Connecting to ${host}… (READ-ONLY)`);

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
  });

  const { data, error } = await supabase
    .from('app_state')
    .select('data')
    .eq('id', 1)
    .single();

  if (error) {
    console.error('✘ Supabase fetch failed:', error.message, `(code: ${error.code})`);
    process.exit(1);
  }

  const blob = (data as { data: Record<string, unknown> | null })?.data ?? {};
  const keys = Object.keys(blob).sort();

  // ── Write the snapshot ──
  const backupsDir = path.resolve(process.cwd(), 'backups');
  fs.mkdirSync(backupsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = path.join(backupsDir, `app_state-backup-${stamp}.json`);
  // Wrap with metadata so the file is self-describing for a restore.
  const payload = {
    _backup: {
      takenAt: new Date().toISOString(),
      source: `${host}.../app_state#1`,
      note: 'Full app_state JSONB snapshot taken before financial reset.',
    },
    data: blob,
  };
  const serialized = JSON.stringify(payload, null, 2);
  fs.writeFileSync(outPath, serialized, 'utf8');

  console.log(`\n✓ Backup written: ${outPath}`);
  console.log(`  size: ${fmtBytes(Buffer.byteLength(serialized))} | collections: ${keys.length}`);
  console.log('\n  Per-collection counts:');
  for (const k of keys) {
    const v = (blob as Record<string, unknown>)[k];
    const count = Array.isArray(v) ? String(v.length) : v == null ? 'null' : typeof v;
    console.log(`    ${k.padEnd(26)} ${count}`);
  }
  console.log('\n  Restore: write `payload.data` back into app_state row id=1 (upsert).');
}

main().catch((err) => {
  console.error('✘ Unexpected error:', err);
  process.exit(1);
});
