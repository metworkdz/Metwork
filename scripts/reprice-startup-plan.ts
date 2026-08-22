/**
 * Apply the 2026-08 Startup (formerly Founder) repricing to the LIVE plan
 * config: 7 900 → 3 500 DZD/month, consultation discount 10 % → 20 %.
 *
 * WHY A SCRIPT AT ALL
 * Plan-config seeding is additive by design — `ensureMembershipPlanConfigs`
 * appends missing plan codes and never overwrites a stored record, so nobody's
 * admin edits can be clobbered by a deploy. The consequence is that changing
 * `DEFAULT_PLAN_BENEFITS` reaches a fresh database but NOT a deployment whose
 * configs were already seeded. The app carries a one-time repricing guarded by
 * `meta.membershipStartupRepricedAt`, but it only fires when an admin opens the
 * Pricing & Commissions page. This script performs the same write deliberately,
 * at deploy time, so the public pricing page is never left advertising 7 900.
 *
 * Running the script and opening the admin page are interchangeable and safe in
 * either order: both are guarded by the same flag, and whichever runs second is
 * a no-op.
 *
 * WHAT IT DOES NOT DO
 *   • Does not touch any ACTIVE membership. Members hold a FROZEN SNAPSHOT of
 *     what they bought (rates, price, pass count) on their membership record,
 *     and `resolveMemberBenefits` reads that before the config. Somebody who
 *     paid 47 400 for six months at 10 % keeps those terms until renewal.
 *   • Does not touch the Entrepreneur plan, pass allowances, commission rules,
 *     or any other collection.
 *   • Does not change `annualDiscountPercent`, `spaceDiscountRate` or the
 *     Recommended tag — if an admin has tuned those, their values survive.
 *
 * SAFE BY DEFAULT: prints a DRY RUN (field-level diff) and writes nothing
 * unless `--confirm` is passed. Take a backup first:
 *   npx tsx scripts/backup-app-state.ts
 *
 * Run (preview):  npx tsx scripts/reprice-startup-plan.ts
 * Run (apply):    npx tsx scripts/reprice-startup-plan.ts --confirm
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const CONFIRM = process.argv.includes('--confirm');

/** The two fields this repricing changes. Mirrors STARTUP_REPRICE in plan-config.ts. */
const TARGET = {
  monthlyPrice: 3_500,
  consultationDiscountRate: 0.2,
} as const;

const FLAG = 'membershipStartupRepricedAt';

type Blob = Record<string, unknown>;
type PlanConfig = Record<string, unknown> & {
  planCode: string;
  monthlyPrice?: number;
  consultationDiscountRate?: number;
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

/** Cycle prices, mirroring `computeCyclePrices` — for the printed preview only. */
function cyclePrices(monthly: number, semesterlyMonths: number, annualPercent: number) {
  return {
    semesterly: monthly * semesterlyMonths,
    annual: Math.round(monthly * 12 * (1 - annualPercent / 100)),
  };
}

async function main() {
  const { url, key } = loadCreds();
  const host = url.replace(/^https:\/\//, '').slice(0, 30);
  console.log(CONFIRM ? '⚠  LIVE WRITE MODE (--confirm)' : '🔎 DRY RUN (no flag) — nothing will be written');
  console.log(`→ Target: ${host}… app_state#1 (membershipPlanConfigs.STARTUP only)`);

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
  });

  const blob = await fetchBlob(supabase);
  const meta = (blob.meta ?? {}) as Record<string, unknown>;

  if (meta[FLAG]) {
    console.log(`\n✓ Nothing to do — repricing already applied at ${String(meta[FLAG])}.`);
    return;
  }

  const configs = Array.isArray(blob.membershipPlanConfigs)
    ? (blob.membershipPlanConfigs as PlanConfig[])
    : [];
  const startup = configs.find((c) => c.planCode === 'STARTUP');

  if (!startup) {
    // Nothing stored yet: the app's own additive seeding will write the record
    // at the new terms on first admin load. Setting the flag here would be a
    // lie about work that has not happened, so we leave it alone.
    console.log('\n✓ Nothing to do — no stored STARTUP config; seeding will use the new terms.');
    return;
  }

  const beforePrice = startup.monthlyPrice;
  const beforeRate = startup.consultationDiscountRate;
  const months = typeof startup.semesterlyMonths === 'number' ? startup.semesterlyMonths : 6;
  const annualPct =
    typeof startup.annualDiscountPercent === 'number' ? startup.annualDiscountPercent : 30;

  const before = cyclePrices(Number(beforePrice ?? 0), months, annualPct);
  const after = cyclePrices(TARGET.monthlyPrice, months, annualPct);

  console.log(`\n── ${CONFIRM ? 'Applying' : 'Planned change'} — STARTUP plan ──`);
  console.log(`  monthlyPrice              ${beforePrice} → ${TARGET.monthlyPrice} DZD`);
  console.log(`  consultationDiscountRate  ${beforeRate} → ${TARGET.consultationDiscountRate}`);
  console.log(`  (derived) semesterly      ${before.semesterly} → ${after.semesterly} DZD`);
  console.log(`  (derived) annual          ${before.annual} → ${after.annual} DZD  (−${annualPct}%)`);
  console.log(`  spaceDiscountRate         ${startup.spaceDiscountRate} (unchanged)`);

  const activeStartupMembers = (Array.isArray(blob.userMemberships) ? blob.userMemberships : [])
    .filter((m) => {
      const r = m as Record<string, unknown>;
      const plan = String(r.plan ?? '').toUpperCase();
      return r.status === 'ACTIVE' && (plan === 'STARTUP' || plan === 'FOUNDER');
    });
  const snapshotted = activeStartupMembers.filter(
    (m) => (m as Record<string, unknown>).spaceDiscountRate !== undefined,
  );
  console.log(
    `\n  active Startup members: ${activeStartupMembers.length} ` +
      `(${snapshotted.length} carry a frozen snapshot and are unaffected)`,
  );
  if (activeStartupMembers.length !== snapshotted.length) {
    console.log(
      '  ⚠  Some active members have NO snapshot — open the admin Pricing & ' +
        'Commissions page BEFORE running this with --confirm, so the legacy-terms ' +
        'backfill grandfathers them onto the terms they actually bought.',
    );
  }

  if (!CONFIRM) {
    console.log('\n🔎 DRY RUN complete. No data was modified.');
    console.log('   Re-run with --confirm to apply (take a backup first: npx tsx scripts/backup-app-state.ts).');
    return;
  }

  const nowIso = new Date().toISOString();
  const nextConfigs = configs.map((c) =>
    c.planCode === 'STARTUP'
      ? {
          ...c,
          monthlyPrice: TARGET.monthlyPrice,
          consultationDiscountRate: TARGET.consultationDiscountRate,
          updatedAt: nowIso,
        }
      : c,
  );

  // Single atomic upsert of the whole document — only the two fields above and
  // the guard flag change; every other collection is preserved verbatim.
  const after_: Blob = {
    ...blob,
    membershipPlanConfigs: nextConfigs,
    meta: { ...meta, [FLAG]: nowIso },
  };
  const { error } = await supabase.from('app_state').upsert({ id: 1, data: after_ }, { onConflict: 'id' });
  if (error) {
    console.error('✘ Supabase upsert failed:', error.message, `(code: ${error.code})`);
    process.exit(1);
  }

  // Re-read and verify against the authoritative state.
  const verifyBlob = await fetchBlob(supabase);
  const verifyConfigs = Array.isArray(verifyBlob.membershipPlanConfigs)
    ? (verifyBlob.membershipPlanConfigs as PlanConfig[])
    : [];
  const verified = verifyConfigs.find((c) => c.planCode === 'STARTUP');
  if (
    verified?.monthlyPrice !== TARGET.monthlyPrice ||
    verified?.consultationDiscountRate !== TARGET.consultationDiscountRate
  ) {
    console.error('✘ Repricing wrote but verification FAILED — stored values do not match.');
    process.exit(1);
  }
  console.log(
    `\n✓ Repricing applied and verified: STARTUP now ${TARGET.monthlyPrice} DZD/mo ` +
      `(${after.semesterly} / 6 mo, ${after.annual} / yr), 20 % consultations.`,
  );
}

main().catch((err) => {
  console.error('✘ Unexpected error:', err);
  process.exit(1);
});
