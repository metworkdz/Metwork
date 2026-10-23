/**
 * Apply the Metwork 2.0 membership terms to the LIVE plan config.
 *
 *   Founder (STARTUP)        3 500 → 1 900 DZD/month, annual discount → 20 %,
 *                            consultations → 10 %, spaces → 10 %, Recommended
 *   Entrepreneur (retired)   no longer Recommended (already not sold in code)
 *   Freelancer Premium       appended at 2 500 DZD/month if not stored yet
 *
 * GRANDFATHERING FIRST. Before any price moves, every ACTIVE membership that
 * still reads live config is frozen at the terms it has today, and every paid
 * member with neither a snapshot nor a mirror gets a mirror. So a Startup
 * member who paid for 20 % consultations keeps 20 % until their period ends,
 * then renews as Founder at the new terms. The logic is
 * `applyMetwork2PlanTerms` in src/server/memberships/plan-config.ts — the same
 * function the tests run — applied here to the fetched document.
 *
 * NOT run by the app on its own (unlike the 2026-08 repricing): a live price
 * change ships only when someone runs this with --confirm.
 *
 * SAFE BY DEFAULT: prints a DRY RUN and writes nothing unless `--confirm`.
 * Take a backup first:
 *   npx tsx scripts/backup-app-state.ts
 *
 * Run (preview):  npx tsx scripts/metwork2-reprice-memberships.ts
 * Run (apply):    npx tsx scripts/metwork2-reprice-memberships.ts --confirm
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const CONFIRM = process.argv.includes('--confirm');
type Blob = Record<string, unknown>;

function loadEnvLocal(): { url: string; key: string } {
  const file = path.resolve(process.cwd(), '.env.local');
  if (!fs.existsSync(file)) {
    console.error(`✘ ${file} not found — no Supabase creds available.`);
    process.exit(1);
  }
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && process.env[m[1]!] === undefined) {
      process.env[m[1]!] = m[2]!.trim().replace(/^['"]|['"]$/g, '');
    }
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
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

async function fetchBlob(supabase: SupabaseClient): Promise<Blob> {
  const { data, error } = await supabase.from('app_state').select('data').eq('id', 1).single();
  if (error) {
    console.error('✘ Supabase fetch failed:', error.message, `(code: ${error.code})`);
    process.exit(1);
  }
  return ((data as { data: Blob | null })?.data ?? {}) as Blob;
}

async function main() {
  const { url, key } = loadEnvLocal();
  // Imported after the env is loaded: plan-config pulls in the store module.
  const { applyMetwork2PlanTerms, planConfigsFrom, pricesForConfig } = await import(
    '../src/server/memberships/plan-config'
  );

  console.log(CONFIRM ? '⚠  LIVE WRITE MODE (--confirm)' : '🔎 DRY RUN (no flag) — nothing will be written');
  console.log(`→ Target: ${url.replace(/^https:\/\//, '').slice(0, 30)}… app_state#1`);

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
  });

  const blob = await fetchBlob(supabase);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const draft = structuredClone(blob) as any;
  if (!Array.isArray(draft.users)) draft.users = [];
  const report = applyMetwork2PlanTerms(draft);

  if (report.alreadyApplied) {
    console.log('\n✓ Nothing to do — Metwork 2.0 terms were already applied.');
    return;
  }

  const fmt = (n: number) => n.toLocaleString('fr-DZ');
  console.log('\n── Grandfathering (done before prices move) ──');
  console.log(`  active memberships frozen at current terms: ${report.frozenMembershipIds.length}`);
  console.log(`  paid members given a mirror of current terms: ${report.mirroredUserIds.length}`);
  console.log('\n── Founder (STARTUP) ──');
  if (report.startupBefore) {
    const b = report.startupBefore;
    console.log(`  before  ${fmt(b.monthlyPrice)} /mo · annual −${b.annualDiscountPercent}% · consult ${b.consultationDiscountRate} · spaces ${b.spaceDiscountRate}`);
  } else {
    console.log('  before  (not stored — shipped defaults)');
  }
  for (const c of planConfigsFrom(draft)) {
    const p = pricesForConfig(c);
    console.log(`  after   ${c.planCode.padEnd(19)} ${fmt(p.monthly)} /mo · ${fmt(p.annual)} /yr · consult ${c.consultationDiscountRate} · spaces ${c.spaceDiscountRate}${c.recommended ? ' · recommended' : ''}`);
  }

  if (!CONFIRM) {
    console.log('\n🔎 DRY RUN complete. No data was modified.');
    console.log('   Re-run with --confirm to apply (take a backup first: npx tsx scripts/backup-app-state.ts).');
    return;
  }

  // Re-read immediately before writing and apply to THAT, so the window in
  // which a concurrent app write could be overwritten is as short as possible.
  const fresh = await fetchBlob(supabase);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toWrite = structuredClone(fresh) as any;
  if (!Array.isArray(toWrite.users)) toWrite.users = [];
  const applied = applyMetwork2PlanTerms(toWrite);
  if (applied.alreadyApplied) {
    console.log('\n✓ Applied by someone else in the meantime — nothing written.');
    return;
  }
  const { error } = await supabase.from('app_state').upsert({ id: 1, data: toWrite }, { onConflict: 'id' });
  if (error) {
    console.error('✘ Write failed:', error.message);
    process.exit(1);
  }
  console.log(`\n✓ Applied. Frozen ${applied.frozenMembershipIds.length} memberships, mirrored ${applied.mirroredUserIds.length} members.`);
}

main().catch((err) => {
  console.error('✘ Unexpected error:', err);
  process.exit(1);
});
