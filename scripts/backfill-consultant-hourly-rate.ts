/**
 * Backfill the canonical per-hour `consultationFee` for existing self-signup
 * consultants who set a rate under the OLD portal (which wrote the now-retired
 * `ratePer60` "60-minute price" instead of `consultationFee`).
 *
 * Context: the self-service portal used to store display-only `ratePer30` /
 * `ratePer60`, which nothing read — so those consultants showed up as "Free".
 * The portal now writes the canonical `consultationFee` (the field the charge
 * engine + public profile + booking dialogs all read). This one-off carries a
 * previously-entered 60-minute price over to `consultationFee` so nobody's rate
 * silently disappears after the switch.
 *
 * RULE (idempotent + money-safe):
 *   set consultationFee ← ratePer60   ONLY WHEN
 *     • consultationFee is missing or 0  (never overwrite a real fee), AND
 *     • ratePer60 is a positive number   (a true hourly equivalent).
 *   A consultant who only ever set `ratePer30` (a half-hour price) is left
 *   untouched — we don't guess an hourly rate from it; they re-enter it once.
 *
 *   Second run reports "0 records to touch" (consultationFee now present).
 *   No deletions, no renames, no other collection touched. ratePer30/ratePer60
 *   are left in place (harmless legacy fields).
 *
 * SAFE BY DEFAULT: prints a DRY RUN (per-record diff + counts) and writes
 * nothing unless `--confirm` is passed. Take a backup first:
 *   npx tsx scripts/backup-app-state.ts
 *
 * Run (preview):  npx tsx scripts/backfill-consultant-hourly-rate.ts
 * Run (apply):    npx tsx scripts/backfill-consultant-hourly-rate.ts --confirm
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const CONFIRM = process.argv.includes('--confirm');

type Blob = Record<string, unknown>;
type MentorLike = Record<string, unknown> & {
  id: string;
  fullName?: string;
  source?: 'ADMIN' | 'SELF';
  consultationFee?: number;
  ratePer30?: number | null;
  ratePer60?: number | null;
  updatedAt?: string;
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
  from: string;
  to: string;
}

/** Pure transform: returns the patched mentor list plus the per-record diff. */
function planBackfill(mentors: MentorLike[]): {
  next: MentorLike[];
  diffs: Map<string, FieldChange[]>;
} {
  const diffs = new Map<string, FieldChange[]>();
  const next = mentors.map((m) => ({ ...m }));

  for (const m of next) {
    const hasFee = typeof m.consultationFee === 'number' && m.consultationFee > 0;
    const legacyHourly = typeof m.ratePer60 === 'number' && m.ratePer60 > 0 ? m.ratePer60 : null;
    if (!hasFee && legacyHourly !== null) {
      const before = m.consultationFee;
      m.consultationFee = legacyHourly;
      diffs.set(m.id, [{
        field: 'consultationFee',
        from: before === undefined ? '(absent)' : String(before),
        to: String(legacyHourly),
      }]);
    }
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
  console.log(`  records left as-is: ${mentors.length - diffs.size}`);

  for (const m of mentors) {
    const changes = diffs.get(m.id);
    if (!changes) continue;
    console.log(`\n  • ${m.fullName ?? '(no name)'}  [${m.id}]  source=${m.source ?? '(absent)'}`);
    for (const c of changes) {
      console.log(`      ${c.field.padEnd(16)} ${c.from} → ${c.to}  (from legacy ratePer60)`);
    }
  }

  if (diffs.size === 0) {
    console.log('\n✓ Nothing to do — no consultant has a legacy 60-min rate awaiting migration.');
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
    console.error(`✘ Backfill wrote but verification FAILED — ${residual.size} record(s) still pending.`);
    process.exit(1);
  }
  console.log(`\n✓ Backfill applied and verified: ${diffs.size} record(s) updated, ${mentors.length} total, 0 residual.`);
}

main().catch((err) => {
  console.error('✘ Unexpected error:', err);
  process.exit(1);
});
