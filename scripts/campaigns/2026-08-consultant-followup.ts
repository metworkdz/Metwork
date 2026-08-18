/**
 * ONE-OFF campaign: follow up with consultants/mentors who had an onboarding
 * call with the Metwork team — ask if they've tried the platform yet, invite
 * feedback, and remind them of the value on offer.
 *
 * This is NOT a general-purpose broadcast tool. It reuses the existing Resend
 * transport (`sendResendEmail`) and the shared email `layout()` — no parallel
 * mail system — and it is the only caller of `consultantFollowup2026EmailHtml`.
 * Structurally a clone of `2026-08-consultant-update.ts`, the previous one-off
 * consultant campaign, with two deliberate differences: TEST mode is the
 * default (no flag needed) and always targets one hardcoded address, and BULK
 * mode logs a per-recipient result line to a local file in addition to stdout.
 *
 * ── Modes ──────────────────────────────────────────────────────────────────
 *   (no flags)          TEST MODE — the default, safe mode. Renders with a
 *                       sample first name, writes an HTML preview to disk,
 *                       and sends ONE email to the hardcoded reviewer address
 *                       below. Never reads or touches the mentors list, never
 *                       writes to the DB, never touches campaignSends.
 *
 *   --dry-run           Bulk dry run: reads the real mentor list, prints the
 *                       exact recipient list and greetings, sends nothing.
 *
 *   --confirm-bulk-send The real batch. The script still asks for an
 *                       interactive "SEND" before the first email leaves —
 *                       a second, independent gate on top of the flag.
 *
 * ── Safety ─────────────────────────────────────────────────────────────────
 *   • CRITICAL: bulk mode must only be run after Mohamed has reviewed the
 *     test email in his own inbox and given explicit, separate approval.
 *     Nothing in this file infers that approval — it must come as a new
 *     instruction.
 *   • Idempotent: every successful send is appended to `campaignSends` in the
 *     app-state blob (the same generic array the 2026-08 update campaign
 *     introduced), keyed by (campaignId, mentorId). A re-run after a partial
 *     batch skips everyone already logged — nobody is emailed twice.
 *   • One failure never stops the batch.
 *   • Recipients are every mentor record with a usable email — no
 *     approvalStatus filter, matching the prior campaign's convention.
 *
 * Run (preview + test send): npx tsx scripts/campaigns/2026-08-consultant-followup.ts
 * Run (dry run):              npx tsx scripts/campaigns/2026-08-consultant-followup.ts --dry-run
 * Run (for real):              npx tsx scripts/campaigns/2026-08-consultant-followup.ts --confirm-bulk-send
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  sendResendEmail,
  consultantFollowup2026EmailHtml,
  CONSULTANT_FOLLOWUP_2026_08_SUBJECT,
} from '../../src/server/notifications/email';

/** Stable idempotency key for this campaign. Never change it after a send. */
const CAMPAIGN_ID = '2026-08-consultant-followup';

/** Hardcoded TEST MODE recipient — never derived from args or the DB. */
const TEST_RECIPIENT = 'mohamedbenhamada71@yahoo.fr';

/** Public production origin — the only host a mail client can resolve. */
const PUBLIC_ORIGIN = 'https://metwork.dz';

/** French consultant portal. Locale-prefixed so the CTA skips a redirect. */
const DASHBOARD_URL = `${PUBLIC_ORIGIN}/fr/mentordashboard`;

/**
 * The template invites a reply, but `from` is the fixed `noreply@metwork.dz`
 * sender — without Reply-To, a recipient hitting "reply" would address a
 * mailbox nobody reads.
 */
const REPLY_TO = 'contact@metwork.dz';

/**
 * Resend's documented default limit is 2 requests/second. Sending one email
 * every 700 ms with a pause between batches stays comfortably under it, and
 * the whole run is still well under a minute at this list size. Same pacing
 * as the 2026-08-consultant-update campaign.
 */
const BATCH_SIZE = 10;
const DELAY_BETWEEN_SENDS_MS = 700;
const DELAY_BETWEEN_BATCHES_MS = 3_000;

const PREVIEW_PATH = path.resolve(process.cwd(), 'scripts/campaigns/.preview-followup.html');
const LOG_DIR = path.resolve(process.cwd(), 'scripts/campaigns/logs');

/* ─────────────────────────────── types ─────────────────────────────── */

type Blob = Record<string, unknown>;

interface MentorLike {
  id: string;
  fullName?: string;
  email?: string | null;
  approvalStatus?: 'PENDING' | 'APPROVED' | 'REJECTED';
  source?: 'ADMIN' | 'SELF';
}

interface CampaignSend {
  campaignId: string;
  mentorId: string;
  email: string;
  sentAt: string;
}

interface Recipient {
  mentorId: string;
  email: string;
  /** Greeting name actually used in the email (may be an override). */
  firstName: string;
  /** Raw stored name — printed in the dry run so bad greetings are easy to spot. */
  fullName: string;
}

/* ────────────────────────────── env / db ───────────────────────────── */

/**
 * Load `.env.local` by hand and push the values onto process.env.
 *
 * Deliberately bypasses `src/lib/env.ts`: that module validates the FULL
 * server schema at import time, which a standalone script has no business
 * requiring. Same approach as `2026-08-consultant-update.ts` and the backfill
 * scripts.
 */
function loadEnv(): { supabaseUrl: string; supabaseKey: string } {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) {
    console.error(`✘ ${envPath} not found — no credentials available.`);
    process.exit(1);
  }
  const map: Record<string, string> = {};
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) map[m[1]!] = m[2]!.trim().replace(/^['"]|['"]$/g, '');
  }

  // sendResendEmail reads these lazily off process.env at first call.
  if (map.RESEND_API_KEY) process.env.RESEND_API_KEY = map.RESEND_API_KEY;
  if (map.EMAIL_FROM) process.env.EMAIL_FROM = map.EMAIL_FROM;

  if (!process.env.RESEND_API_KEY) {
    console.error('✘ RESEND_API_KEY missing from .env.local — sendResendEmail would silently no-op.');
    process.exit(1);
  }

  const supabaseUrl = map.SUPABASE_URL;
  const supabaseKey = map.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error('✘ SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing from .env.local');
    process.exit(1);
  }
  return { supabaseUrl, supabaseKey };
}

async function readBlob(sb: SupabaseClient): Promise<Blob> {
  const { data, error } = await sb.from('app_state').select('data').eq('id', 1).single();
  if (error) {
    console.error('✘ Failed to read app_state:', error.message);
    process.exit(1);
  }
  return (data as { data: Blob }).data;
}

/**
 * Append ONE send record.
 *
 * Re-reads the blob immediately before writing so the window in which a
 * concurrent app write could be clobbered is as small as possible — the app
 * itself is last-write-wins on this single JSONB document, so this matches
 * existing semantics rather than introducing a new hazard. Only
 * `campaignSends` is mutated.
 */
async function logSend(sb: SupabaseClient, record: CampaignSend): Promise<void> {
  const blob = await readBlob(sb);
  const existing = Array.isArray(blob.campaignSends) ? (blob.campaignSends as CampaignSend[]) : [];
  const next = { ...blob, campaignSends: [...existing, record] };
  const { error } = await sb.from('app_state').upsert({ id: 1, data: next }, { onConflict: 'id' });
  if (error) throw new Error(`campaignSends write failed: ${error.message}`);
}

/* ────────────────────────────── local log file ─────────────────────── */

interface SendLogLine {
  timestamp: string;
  email: string;
  mentorId: string;
  result: 'sent' | 'failed';
  reason?: string;
}

function openLogFile(): { logPath: string; write: (line: SendLogLine) => void } {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  const logPath = path.join(LOG_DIR, `${CAMPAIGN_ID}-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
  const write = (line: SendLogLine): void => {
    fs.appendFileSync(logPath, `${JSON.stringify(line)}\n`, 'utf8');
  };
  return { logPath, write };
}

/* ───────────────────────────── recipients ──────────────────────────── */

/** Every consultant with a usable email — no approvalStatus filter, matching the prior campaign. */
function isEligible(m: MentorLike): boolean {
  const email = typeof m.email === 'string' ? m.email.trim() : '';
  return !!email && email.includes('@');
}

/**
 * Manual greeting overrides, keyed by mentor id — copied from
 * `2026-08-consultant-update.ts` since it's the same mentor population.
 * `fullName` is free text and a good number of consultants entered it
 * SURNAME-first ("BOUDRAA Lyes", "Salhi Taous"), so the naive first token
 * greets them by their family name. The dry run prints the greeting chosen
 * for every recipient; extend this map for anyone it gets wrong.
 */
const NAME_OVERRIDES: Record<string, string> = {
  '50ba2c55-e110-4214-a612-3aa80de5fc41': 'Lyes',        // "BOUDRAA Lyes" — caps = surname-first
  '53be6a8f-c89d-417a-aeb4-efc945858d4f': 'Mohamed',     // "Sadeg mohamed" — Sadeg is a surname
  '302f8b68-4ff4-4b87-9342-6907ac94a3ab': 'Abderraouf',  // "Khenchouche abderraouf" — Khenchouche is a surname
  '1525631b-b13d-4449-ba94-050c37d8b959': 'Taous',       // "Salhi Taous" — Salhi is a surname
  '516c6f23-a848-46b4-8927-8e8feef20ba3': 'Mohammad',    // "Benmoussa Mohammad" — Benmoussa is a surname
  'e7a10326-abd8-4e7e-aa25-05542c8186f9': 'Abdelkader',  // "Boudia Abdelkader Rayane" — Boudia is a surname
};

/** "MOKHTARIA" → "Mokhtaria", "shanez" → "Shanez". Leaves accents alone. */
function titleCase(token: string): string {
  return token.charAt(0).toLocaleUpperCase('fr') + token.slice(1).toLocaleLowerCase('fr');
}

/**
 * Greeting name: an explicit override when present, otherwise the first token
 * of the full name, title-cased. Empty ⇒ the template drops the name.
 */
function firstNameOf(mentorId: string, fullName?: string): string {
  const override = NAME_OVERRIDES[mentorId];
  if (override !== undefined) return override.trim();
  const token = (fullName ?? '').trim().split(/\s+/)[0] ?? '';
  return token ? titleCase(token) : '';
}

/** Eligible, not-yet-sent, de-duplicated by email address. */
function resolveRecipients(blob: Blob): { recipients: Recipient[]; alreadySent: number; skippedDupes: number } {
  const mentors = Array.isArray(blob.mentors) ? (blob.mentors as MentorLike[]) : [];
  const sends = Array.isArray(blob.campaignSends) ? (blob.campaignSends as CampaignSend[]) : [];

  const sentMentorIds = new Set(sends.filter((s) => s.campaignId === CAMPAIGN_ID).map((s) => s.mentorId));
  const sentEmails = new Set(
    sends.filter((s) => s.campaignId === CAMPAIGN_ID).map((s) => s.email.trim().toLowerCase()),
  );

  const seen = new Set<string>();
  const recipients: Recipient[] = [];
  let alreadySent = 0;
  let skippedDupes = 0;

  for (const m of mentors) {
    if (!isEligible(m)) continue;
    const email = (m.email ?? '').trim();
    const key = email.toLowerCase();

    if (sentMentorIds.has(m.id) || sentEmails.has(key)) { alreadySent++; continue; }
    if (seen.has(key)) { skippedDupes++; continue; }

    seen.add(key);
    recipients.push({
      mentorId:  m.id,
      email,
      firstName: firstNameOf(m.id, m.fullName),
      fullName:  (m.fullName ?? '').trim(),
    });
  }

  return { recipients, alreadySent, skippedDupes };
}

/* ─────────────────────────────── helpers ───────────────────────────── */

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Interactive gate — the second safety net, independent of --confirm-bulk-send. */
function askToProceed(count: number): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`\nType SEND to confirm sending to ${count} consultants: `, (answer) => {
      rl.close();
      resolve(answer.trim() === 'SEND');
    });
  });
}

/* ──────────────────────────────── modes ────────────────────────────── */

async function runTest(): Promise<void> {
  const html = consultantFollowup2026EmailHtml({ firstName: 'Mohamed', dashboardUrl: DASHBOARD_URL });

  fs.writeFileSync(PREVIEW_PATH, html, 'utf8');
  console.log(`✓ Preview written → ${path.relative(process.cwd(), PREVIEW_PATH)}`);

  const fallbackPath = PREVIEW_PATH.replace(/\.html$/, '-no-name.html');
  fs.writeFileSync(
    fallbackPath,
    consultantFollowup2026EmailHtml({ firstName: '', dashboardUrl: DASHBOARD_URL }),
    'utf8',
  );
  console.log(`✓ Preview (no first name) → ${path.relative(process.cwd(), fallbackPath)}`);

  console.log(`\nSubject: ${CONSULTANT_FOLLOWUP_2026_08_SUBJECT}`);
  console.log(`From:    ${process.env.EMAIL_FROM ?? 'noreply@metwork.dz'}`);
  console.log(`CTA:     ${DASHBOARD_URL}`);

  const ok = await sendResendEmail({ to: TEST_RECIPIENT, subject: CONSULTANT_FOLLOWUP_2026_08_SUBJECT, html, replyTo: REPLY_TO });
  if (!ok) {
    console.log(`\n✘ Test email to ${TEST_RECIPIENT} was NOT delivered (see error above)`);
    process.exit(1);
  }
  console.log(`\n✓ TEST SEND COMPLETE — reply/check inbox (${TEST_RECIPIENT}) before approving bulk send.`);
  console.log('  This mode never touched the mentors list or campaignSends. No mentor was emailed.');
}

async function runBulk(confirmed: boolean): Promise<void> {
  const { supabaseUrl, supabaseKey } = loadEnv();
  const sb = createClient(supabaseUrl, supabaseKey);

  const blob = await readBlob(sb);
  const mentors = Array.isArray(blob.mentors) ? (blob.mentors as MentorLike[]) : [];
  const { recipients, alreadySent, skippedDupes } = resolveRecipients(blob);

  console.log(`\nCampaign: ${CAMPAIGN_ID}`);
  console.log(`Mentors in DB:        ${mentors.length}`);
  console.log(`Eligible & pending:   ${recipients.length}`);
  console.log(`Already sent (skip):  ${alreadySent}`);
  console.log(`Duplicate emails:     ${skippedDupes}`);
  console.log(`Excluded (no email):  ${mentors.length - recipients.length - alreadySent - skippedDupes}`);
  console.log('\nRecipients (check each greeting — add a NAME_OVERRIDES entry for any that reads wrong):');
  for (const r of recipients) {
    const greeting = r.firstName ? `Bonjour ${r.firstName},` : 'Bonjour,';
    console.log(`  • ${r.email.padEnd(34)} ${greeting.padEnd(28)} [${r.fullName}] ${r.mentorId}`);
  }

  if (recipients.length === 0) {
    console.log('\nNothing to send. Done.');
    return;
  }

  if (!confirmed) {
    console.log('\n⚠ DRY RUN — no emails sent. Re-run with --confirm-bulk-send to send for real.');
    return;
  }

  if (!(await askToProceed(recipients.length))) {
    console.log('Aborted — nothing sent.');
    return;
  }

  const { logPath, write: writeLog } = openLogFile();
  console.log(`Per-recipient log → ${path.relative(process.cwd(), logPath)}`);

  let sent = 0;
  const failed: Array<{ email: string; reason: string }> = [];

  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    const batch = recipients.slice(i, i + BATCH_SIZE);
    console.log(`\n── Batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length}) ──`);

    for (const r of batch) {
      try {
        const html = consultantFollowup2026EmailHtml({
          firstName:    r.firstName,
          dashboardUrl: DASHBOARD_URL,
        });
        const ok = await sendResendEmail({
          to:      r.email,
          subject: CONSULTANT_FOLLOWUP_2026_08_SUBJECT,
          html,
          replyTo: REPLY_TO,
        });

        if (!ok) {
          const reason = 'Resend rejected or not configured';
          failed.push({ email: r.email, reason });
          writeLog({ timestamp: new Date().toISOString(), email: r.email, mentorId: r.mentorId, result: 'failed', reason });
          console.log(`  ✘ ${r.email} — rejected`);
        } else {
          await logSend(sb, {
            campaignId: CAMPAIGN_ID,
            mentorId:   r.mentorId,
            email:      r.email,
            sentAt:     new Date().toISOString(),
          });
          writeLog({ timestamp: new Date().toISOString(), email: r.email, mentorId: r.mentorId, result: 'sent' });
          sent++;
          console.log(`  ✓ ${r.email}`);
        }
      } catch (err) {
        // One failure must never stop the batch.
        const reason = err instanceof Error ? err.message : String(err);
        failed.push({ email: r.email, reason });
        writeLog({ timestamp: new Date().toISOString(), email: r.email, mentorId: r.mentorId, result: 'failed', reason });
        console.log(`  ✘ ${r.email} — ${reason}`);
      }
      await sleep(DELAY_BETWEEN_SENDS_MS);
    }

    if (i + BATCH_SIZE < recipients.length) await sleep(DELAY_BETWEEN_BATCHES_MS);
  }

  console.log('\n══════════ SUMMARY ══════════');
  console.log(`Total attempted: ${recipients.length}`);
  console.log(`Sent:            ${sent}`);
  console.log(`Failed:          ${failed.length}`);
  console.log(`Log file:        ${path.relative(process.cwd(), logPath)}`);
  if (failed.length > 0) {
    console.log('\nFailed addresses (safe to retry — a re-run skips the successes):');
    for (const f of failed) console.log(`  • ${f.email} — ${f.reason}`);
  }
}

/* ──────────────────────────────── main ─────────────────────────────── */

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.includes('--confirm-bulk-send')) {
    await runBulk(true);
    return;
  }

  if (argv.includes('--dry-run')) {
    await runBulk(false);
    return;
  }

  // Default, no flags: TEST MODE.
  loadEnv();
  await runTest();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
