/**
 * Backfill the consultant-model fields on existing PRODUCTION mentor records
 * (feat/consultant-model). For every mentor, sets ONLY the fields that are
 * still missing — never overwrites a value that is already present, so the
 * script is idempotent (second run reports "0 records to touch") and
 * non-destructive (no deletions, no renames, no other collection touched).
 *
 *   source            missing → 'ADMIN'   (existing records are admin-added)
 *   approvalStatus    missing → 'APPROVED'
 *   publiclyListed    missing → true for ADMIN records, false for SELF records
 *   avatarUrl         missing → current `imageUrl` (the mentors-page image)
 *   slug              missing → name-based, collision-safe (same generator as the app)
 *   updatedAt         missing → `createdAt` (no fake "just modified" stamps)
 *
 * SAFE BY DEFAULT: prints a DRY RUN (per-record field diff + counts) and writes
 * nothing unless `--confirm` is passed. Take a backup first:
 *   npx tsx scripts/backup-app-state.ts
 *
 * Run (preview):  npx tsx scripts/backfill-consultant-model.ts
 * Run (apply):    npx tsx scripts/backfill-consultant-model.ts --confirm
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { slugify, uniqueSlug } from '../src/lib/slugify';

const CONFIRM = process.argv.includes('--confirm');

type Blob = Record<string, unknown>;
type MentorLike = Record<string, unknown> & {
  id: string;
  fullName?: string;
  imageUrl?: string;
  slug?: string;
  createdAt?: string;
  updatedAt?: string;
  source?: 'ADMIN' | 'SELF';
  approvalStatus?: string;
  publiclyListed?: boolean;
  avatarUrl?: string | null;
};

// ── Load real Supabase creds from the repo's .env.local ───────────────────
function loadCreds(): { url: string; key: string } {
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
  const url = envMap.SUPABASE_URL;
  const key = envMap.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('✘ SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing from .env.local');
    process.exit(1);
  }
  if (url.includes('placeholder')) {
    console.error('✘ .env.local still has a placeholder Supabase URL — refusing to run.');
    process.exit(1);
  }
  return { url, key };
}

interface FieldChange {
  field: string;
  to: string;
}

/**
 * Pure transform: returns the patched mentor list plus the per-record diff.
 * Mirrors `deriveMentorSlug` in src/server/mentors/service.ts — slugs already
 * taken by OTHER mentors (including ones assigned earlier in this same pass)
 * stay reserved, so two "Mohamed Amine"s can never collide.
 */
function planBackfill(mentors: MentorLike[]): {
  next: MentorLike[];
  diffs: Map<string, FieldChange[]>;
} {
  const diffs = new Map<string, FieldChange[]>();
  const next = mentors.map((m) => ({ ...m }));

  for (const m of next) {
    const changes: FieldChange[] = [];

    if (m.source === undefined) {
      m.source = 'ADMIN';
      changes.push({ field: 'source', to: "'ADMIN'" });
    }
    if (m.approvalStatus === undefined) {
      m.approvalStatus = 'APPROVED';
      changes.push({ field: 'approvalStatus', to: "'APPROVED'" });
    }
    if (m.publiclyListed === undefined) {
      m.publiclyListed = m.source !== 'SELF';
      changes.push({ field: 'publiclyListed', to: String(m.publiclyListed) });
    }
    if (m.avatarUrl === undefined || m.avatarUrl === null) {
      m.avatarUrl = m.imageUrl ?? null;
      changes.push({ field: 'avatarUrl', to: JSON.stringify(m.avatarUrl) });
    }
    if (!m.slug) {
      const taken = next.filter((x) => x.id !== m.id && x.slug).map((x) => x.slug as string);
      m.slug = uniqueSlug(slugify(m.fullName ?? '') || m.id, taken);
      changes.push({ field: 'slug', to: JSON.stringify(m.slug) });
    }
    if (m.updatedAt === undefined) {
      m.updatedAt = m.createdAt ?? new Date().toISOString();
      changes.push({ field: 'updatedAt', to: JSON.stringify(m.updatedAt) });
    }

    if (changes.length > 0) diffs.set(m.id, changes);
  }

  return { next, diffs };
}

async function fetchBlob(supabase: SupabaseClient): Promise<Blob> {
  const { data, error } = await supabase
    .from('app_state')
    .select('data')
    .eq('id', 1)
    .single();
  if (error) {
    console.error('✘ Supabase fetch failed:', error.message, `(code: ${error.code})`);
    process.exit(1);
  }
  return ((data as { data: Blob | null })?.data ?? {}) as Blob;
}

async function main() {
  const { url, key } = loadCreds();
  const host = url.replace(/^https:\/\//, '').slice(0, 30);
  console.log(CONFIRM ? '⚠  LIVE WRITE MODE (--confirm)' : '🔎 DRY RUN (no flag) — nothing will be written');
  console.log(`→ Target: ${host}… app_state#1 (mentors collection only)`);

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
  });

  const blob = await fetchBlob(supabase);
  const mentors = Array.isArray(blob.mentors) ? (blob.mentors as MentorLike[]) : [];
  const { next, diffs } = planBackfill(mentors);

  console.log(`\n── ${CONFIRM ? 'Applying' : 'Planned changes'} ──`);
  console.log(`  mentors total:    ${mentors.length}`);
  console.log(`  records to touch: ${diffs.size}`);
  console.log(`  records already complete (skipped): ${mentors.length - diffs.size}`);

  for (const m of mentors) {
    const changes = diffs.get(m.id);
    if (!changes) continue;
    console.log(`\n  • ${m.fullName ?? '(no name)'}  [${m.id}]  source=${m.source ?? '(absent)'}`);
    for (const c of changes) {
      console.log(`      ${c.field.padEnd(16)} (absent) → ${c.to}`);
    }
  }

  if (diffs.size === 0) {
    console.log('\n✓ Nothing to do — all mentor records already carry the consultant-model fields.');
    return;
  }

  if (!CONFIRM) {
    console.log('\n🔎 DRY RUN complete. No data was modified.');
    console.log('   Re-run with --confirm to apply (take a backup first: npx tsx scripts/backup-app-state.ts).');
    return;
  }

  // Single atomic upsert of the whole document — only `mentors` replaced,
  // every other collection and unknown/legacy key preserved verbatim.
  const after: Blob = { ...blob, mentors: next };
  const { error } = await supabase.from('app_state').upsert({ id: 1, data: after }, { onConflict: 'id' });
  if (error) {
    console.error('✘ Supabase upsert failed:', error.message, `(code: ${error.code})`);
    process.exit(1);
  }

  // Re-read and verify: a second plan over the authoritative state must be a no-op.
  const verifyBlob = await fetchBlob(supabase);
  const verifyMentors = Array.isArray(verifyBlob.mentors) ? (verifyBlob.mentors as MentorLike[]) : [];
  const { diffs: residual } = planBackfill(verifyMentors);
  if (residual.size !== 0) {
    console.error(`✘ Backfill wrote but verification FAILED — ${residual.size} record(s) still incomplete.`);
    process.exit(1);
  }
  console.log(`\n✓ Backfill applied and verified: ${diffs.size} record(s) updated, ${mentors.length} total, 0 residual.`);
}

main().catch((err) => {
  console.error('✘ Unexpected error:', err);
  process.exit(1);
});
