/**
 * Permanently remove ONE consultant contract from the Supabase JSONB store.
 *
 * This exists only for purging TEST contracts created while building the
 * feature. It deliberately bypasses the immutability rules in
 * `src/server/consultant-contracts/service.ts` — a signed contract is evidence,
 * and the app has no delete path on purpose. Nothing in the running product
 * should ever call this.
 *
 * What it removes, for the given contract id:
 *   • the `consultantContracts` row
 *   • any `otps` row keyed `contract-sign:<id>` (meaningless without it)
 *   • optionally the stored PDF on Cloudinary (`--with-asset`)
 *
 * What it deliberately KEEPS:
 *   • the consultant's own `mentors` record — deleting a contract is not
 *     deleting the person
 *   • `auditLogs` entries. Those record what an ADMIN did and when; scrubbing
 *     an admin action log is a materially different (and worse) act than
 *     removing a test record. Pass `--with-audit` to drop them too.
 *
 * Dry run by default. Take a backup first:
 *   npx tsx scripts/backup-app-state.ts
 *   npx tsx scripts/delete-consultant-contract.ts <contractId>
 *   npx tsx scripts/delete-consultant-contract.ts <contractId> --confirm
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { v2 as cloudinary } from 'cloudinary';

const CONFIRM = process.argv.includes('--confirm');
const WITH_ASSET = process.argv.includes('--with-asset');
const WITH_AUDIT = process.argv.includes('--with-audit');
const CONTRACT_ID = process.argv.find((a) => /^[0-9a-f-]{36}$/i.test(a));

if (!CONTRACT_ID) {
  console.error('Usage: npx tsx scripts/delete-consultant-contract.ts <contractId> [--confirm] [--with-asset] [--with-audit]');
  process.exit(1);
}

// ── Creds from the repo's .env.local (same as backup-app-state.ts) ─────────
const MAIN_ENV = path.resolve(process.cwd(), '.env.local');
if (!fs.existsSync(MAIN_ENV)) {
  console.error(`✘ ${MAIN_ENV} not found`);
  process.exit(1);
}
for (const line of fs.readFileSync(MAIN_ENV, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('✘ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing');
  process.exit(1);
}

type Row = Record<string, unknown>;
type Store = Record<string, unknown> & {
  consultantContracts?: Array<Row & { id: string; consultantId: string; status: string; finalPdfPublicId?: string | null }>;
  otps?: Array<Row & { userId?: string }>;
  auditLogs?: Array<Row>;
  mentors?: Array<Row & { id: string; fullName?: string; email?: string }>;
};

async function main(): Promise<void> {
  const supabase = createClient(SUPABASE_URL!, SERVICE_KEY!, { auth: { persistSession: false } });

  const { data: row, error } = await supabase.from('app_state').select('data').eq('id', 1).single();
  if (error || !row) {
    console.error('✘ Could not read app_state:', error?.message);
    process.exit(1);
  }
  const store = row.data as Store;

  const contract = (store.consultantContracts ?? []).find((c) => c.id === CONTRACT_ID);
  if (!contract) {
    console.log(`✔ Nothing to do — no contract ${CONTRACT_ID} in the store (already removed?).`);
    return;
  }

  const mentor = (store.mentors ?? []).find((m) => m.id === contract.consultantId);
  const otpKey = `contract-sign:${CONTRACT_ID}`;
  const otps = (store.otps ?? []).filter((o) => o.userId === otpKey);
  const audits = (store.auditLogs ?? []).filter((a) => JSON.stringify(a).includes(CONTRACT_ID));

  console.log(CONFIRM ? '⚠  LIVE WRITE MODE (--confirm)' : '🔎 DRY RUN — nothing will be written');
  console.log('');
  console.log('  contract   :', contract.id);
  console.log('  consultant :', mentor?.fullName ?? '(unknown)', `<${mentor?.email ?? '?'}>`);
  console.log('  status     :', contract.status);
  console.log('  pdf asset  :', contract.finalPdfPublicId ?? '(none)');
  console.log('');
  console.log('  will remove: 1 consultantContracts row');
  console.log('               ', otps.length, 'otps row(s)');
  console.log('               ', WITH_AUDIT ? `${audits.length} auditLogs row(s)` : `0 auditLogs rows (${audits.length} kept — pass --with-audit to drop)`);
  console.log('               ', WITH_ASSET && contract.finalPdfPublicId ? 'the Cloudinary PDF' : 'no Cloudinary asset (pass --with-asset to delete it)');
  console.log('  will KEEP  : the consultant record itself');
  console.log('');

  if (!CONFIRM) {
    console.log('   Re-run with --confirm to apply (take a backup first).');
    return;
  }

  const after: Store = {
    ...store,
    consultantContracts: (store.consultantContracts ?? []).filter((c) => c.id !== CONTRACT_ID),
    otps: (store.otps ?? []).filter((o) => o.userId !== otpKey),
    ...(WITH_AUDIT
      ? { auditLogs: (store.auditLogs ?? []).filter((a) => !JSON.stringify(a).includes(CONTRACT_ID)) }
      : {}),
  };

  const { error: upErr } = await supabase.from('app_state').upsert({ id: 1, data: after }, { onConflict: 'id' });
  if (upErr) {
    console.error('✘ Supabase upsert failed:', upErr.message);
    process.exit(1);
  }
  console.log('✔ Store updated.');

  if (WITH_ASSET && contract.finalPdfPublicId) {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
    try {
      const res = await cloudinary.uploader.destroy(contract.finalPdfPublicId, {
        resource_type: 'raw',
        type: 'authenticated',
      });
      console.log('✔ Cloudinary asset:', res.result);
    } catch (e) {
      console.error('✘ Cloudinary delete failed (store row already removed):', (e as Error).message);
    }
  }

  // Read back, so the result is confirmed against the server rather than assumed.
  const { data: check } = await supabase.from('app_state').select('data').eq('id', 1).single();
  const left = ((check?.data as Store)?.consultantContracts ?? []).filter((c) => c.id === CONTRACT_ID);
  console.log(left.length === 0 ? '✔ Verified: contract is gone.' : '✘ Contract still present!');
}

void main();
