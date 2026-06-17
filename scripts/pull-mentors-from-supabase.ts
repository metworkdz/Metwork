/**
 * Pull mentors from Supabase prod DB → local `.local-db.json`.
 *
 * Reads Supabase credentials from /Users/macbookpro/Downloads/metwork/.env.local
 * (the main repo). Pulls the mentors array out of the app_state row,
 * merges them into our local DB, and persists.
 *
 * Run: npx tsx scripts/pull-mentors-from-supabase.ts
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createClient } from '@supabase/supabase-js';

// ── Load real Supabase creds from the main repo's .env.local ──────────
const MAIN_ENV = '/Users/macbookpro/Downloads/metwork/.env.local';
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
  console.error('✘ SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing from main .env.local');
  process.exit(1);
}
if (SUPABASE_URL.includes('placeholder')) {
  console.error('✘ Main .env.local still has placeholder Supabase URL — cannot pull.');
  process.exit(1);
}

async function main() {
  console.log(`→ Connecting to ${SUPABASE_URL!.replace(/^https:\/\//, '').slice(0, 30)}...`);

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase
    .from('app_state')
    .select('data')
    .eq('id', 1)
    .single();

  if (error) {
    console.error('✘ Supabase fetch failed:', error.message);
    process.exit(1);
  }

  const remote = (data as { data: { mentors?: unknown[] } | null })?.data ?? {};
  const remoteMentors = Array.isArray(remote.mentors) ? remote.mentors : [];
  console.log(`✓ Fetched ${remoteMentors.length} mentor(s) from Supabase`);

  if (remoteMentors.length === 0) {
    console.log('  Nothing to copy. Supabase mentors table is empty too.');
    return;
  }

  // ── Merge into local DB ──
  const LOCAL_DB_PATH = path.resolve(process.cwd(), '.local-db.json');
  const localDb = fs.existsSync(LOCAL_DB_PATH)
    ? JSON.parse(fs.readFileSync(LOCAL_DB_PATH, 'utf8'))
    : {};
  if (!Array.isArray(localDb.mentors)) localDb.mentors = [];

  const existingIds = new Set(localDb.mentors.map((m: { id: string }) => m.id));
  let added = 0;
  let updated = 0;
  for (const m of remoteMentors as { id: string }[]) {
    if (existingIds.has(m.id)) {
      const idx = localDb.mentors.findIndex((x: { id: string }) => x.id === m.id);
      localDb.mentors[idx] = m;
      updated++;
    } else {
      localDb.mentors.push(m);
      added++;
    }
  }

  fs.writeFileSync(LOCAL_DB_PATH, JSON.stringify(localDb, null, 2), 'utf8');
  console.log(`✓ Merged into ${LOCAL_DB_PATH}`);
  console.log(`  added:   ${added}`);
  console.log(`  updated: ${updated}`);
  console.log(`  total:   ${localDb.mentors.length}`);
  console.log('\nMentor list now in local DB:');
  for (const m of localDb.mentors as { id: string; fullName: string; imageUrl?: string }[]) {
    const img = m.imageUrl ? '✓img' : '   ';
    console.log(`  ${img}  ${m.fullName}`);
  }
}

main().catch((err) => {
  console.error('✘ Unexpected error:', err);
  process.exit(1);
});
