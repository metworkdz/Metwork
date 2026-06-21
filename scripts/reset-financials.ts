/**
 * Reset ALL financial movement in the Supabase JSONB store so the platform can
 * switch to LIVE SlickPay keys with a clean slate.
 *
 *   CLEAR to []      transactions, topUpIntents, withdrawalRequests,
 *                    mentorLedgerTxns, mentorWithdrawals, paymentLinks,
 *                    bookings, mentorBookings, mentorConsultations,
 *                    mentorSlotLocks, networkVisits, networkCheckInCodes
 *   ZERO balances    wallets[].balance = 0  (users + incubators)
 *                    mentorWallets[].pendingBalance = 0, availableBalance = 0
 *   PRESERVE         every other collection + any unknown/legacy key, verbatim.
 *
 * Idempotent — re-running yields no further change. The whole mutation is one
 * read → in-memory transform → single upsert(id=1). NEVER credits/refunds, so
 * there is no double-spend surface; it only empties and zeroes.
 *
 * SAFE BY DEFAULT: prints a DRY RUN (before-counts + planned changes) and writes
 * nothing unless `--confirm` is passed. Take a backup first:
 *   npx tsx scripts/backup-app-state.ts
 *
 * Run (preview):  npx tsx scripts/reset-financials.ts
 * Run (apply):    npx tsx scripts/reset-financials.ts --confirm
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const CONFIRM = process.argv.includes('--confirm');

// Collections emptied to [].
const CLEAR_COLLECTIONS = [
  'transactions',
  'topUpIntents',
  'withdrawalRequests',
  'mentorLedgerTxns',
  'mentorWithdrawals',
  'paymentLinks',
  'bookings',
  'mentorBookings',
  'mentorConsultations',
  'mentorSlotLocks',
  'networkVisits',
  'networkCheckInCodes',
] as const;

type Blob = Record<string, unknown>;
type WalletLike = Record<string, unknown> & { balance?: number };
type MentorWalletLike = Record<string, unknown> & {
  pendingBalance?: number;
  availableBalance?: number;
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

function arrLen(v: unknown): number {
  return Array.isArray(v) ? v.length : 0;
}

function sumBy(arr: unknown, field: string): number {
  if (!Array.isArray(arr)) return 0;
  return arr.reduce((acc: number, x) => {
    const n = (x as Record<string, unknown>)?.[field];
    return acc + (typeof n === 'number' ? n : 0);
  }, 0);
}

function countNonZero(arr: unknown, fields: string[]): number {
  if (!Array.isArray(arr)) return 0;
  return arr.filter((x) =>
    fields.some((f) => {
      const n = (x as Record<string, unknown>)?.[f];
      return typeof n === 'number' && n !== 0;
    }),
  ).length;
}

/** Pure transform: returns a new blob with financials cleared/zeroed. */
function applyReset(blob: Blob): Blob {
  const now = new Date().toISOString();
  const next: Blob = { ...blob };

  for (const key of CLEAR_COLLECTIONS) {
    next[key] = [];
  }

  next.wallets = (Array.isArray(blob.wallets) ? (blob.wallets as WalletLike[]) : []).map((w) =>
    w.balance === 0 ? w : { ...w, balance: 0, updatedAt: now },
  );

  next.mentorWallets = (
    Array.isArray(blob.mentorWallets) ? (blob.mentorWallets as MentorWalletLike[]) : []
  ).map((w) =>
    w.pendingBalance === 0 && w.availableBalance === 0
      ? w
      : { ...w, pendingBalance: 0, availableBalance: 0, updatedAt: now },
  );

  return next;
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

function printReport(before: Blob, after: Blob, label: string): void {
  console.log(`\n${label}`);
  console.log('  CLEARED collections (before → after):');
  for (const key of CLEAR_COLLECTIONS) {
    console.log(`    ${key.padEnd(24)} ${String(arrLen(before[key])).padStart(4)} → ${arrLen(after[key])}`);
  }
  console.log('\n  ZEROED balances:');
  console.log(
    `    wallets                  ${arrLen(before.wallets)} wallet(s) | nonzero ` +
      `${countNonZero(before.wallets, ['balance'])} → ${countNonZero(after.wallets, ['balance'])} | ` +
      `sum ${sumBy(before.wallets, 'balance')} → ${sumBy(after.wallets, 'balance')} DZD`,
  );
  console.log(
    `    mentorWallets            ${arrLen(before.mentorWallets)} wallet(s) | nonzero ` +
      `${countNonZero(before.mentorWallets, ['pendingBalance', 'availableBalance'])} → ` +
      `${countNonZero(after.mentorWallets, ['pendingBalance', 'availableBalance'])} | ` +
      `pending ${sumBy(before.mentorWallets, 'pendingBalance')} → ${sumBy(after.mentorWallets, 'pendingBalance')} | ` +
      `available ${sumBy(before.mentorWallets, 'availableBalance')} → ${sumBy(after.mentorWallets, 'availableBalance')} DZD`,
  );

  const cleared = new Set<string>([...CLEAR_COLLECTIONS, 'wallets', 'mentorWallets']);
  const preserved = Object.keys(before)
    .filter((k) => !cleared.has(k))
    .sort();
  console.log(`\n  PRESERVED untouched (${preserved.length} keys): ${preserved.join(', ')}`);
}

async function main() {
  const { url, key } = loadCreds();
  const host = url.replace(/^https:\/\//, '').slice(0, 30);
  console.log(CONFIRM ? '⚠  LIVE WRITE MODE (--confirm)' : '🔎 DRY RUN (no flag) — nothing will be written');
  console.log(`→ Target: ${host}… app_state#1`);

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
  });

  const before = await fetchBlob(supabase);
  const after = applyReset(before);

  printReport(before, after, CONFIRM ? '── Applying ──' : '── Planned changes ──');

  if (!CONFIRM) {
    console.log('\n🔎 DRY RUN complete. No data was modified.');
    console.log('   Re-run with --confirm to apply (take a backup first).');
    return;
  }

  const { error } = await supabase.from('app_state').upsert({ id: 1, data: after }, { onConflict: 'id' });
  if (error) {
    console.error('✘ Supabase upsert failed:', error.message, `(code: ${error.code})`);
    process.exit(1);
  }

  // Re-read to verify the authoritative post-write state.
  const verify = await fetchBlob(supabase);
  let ok = true;
  for (const c of CLEAR_COLLECTIONS) {
    if (arrLen(verify[c]) !== 0) {
      ok = false;
      console.error(`✘ Verify: ${c} still has ${arrLen(verify[c])} rows`);
    }
  }
  if (countNonZero(verify.wallets, ['balance']) !== 0) {
    ok = false;
    console.error('✘ Verify: some wallet balances are still non-zero');
  }
  if (countNonZero(verify.mentorWallets, ['pendingBalance', 'availableBalance']) !== 0) {
    ok = false;
    console.error('✘ Verify: some mentor wallet balances are still non-zero');
  }

  console.log(ok ? '\n✓ Reset applied and verified. All financials clear; balances 0.' : '\n✘ Reset wrote but verification FAILED — inspect above.');
  if (!ok) process.exit(1);
}

main().catch((err) => {
  console.error('✘ Unexpected error:', err);
  process.exit(1);
});
