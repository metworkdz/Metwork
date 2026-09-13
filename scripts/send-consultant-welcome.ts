/**
 * Send the consultant welcome email to a named list of existing consultants.
 *
 * The product sends this automatically when an admin approves someone. This
 * script exists for the population approved BEFORE that existed: they carry no
 * `welcomeEmailSentAt`, so nothing has reached them.
 *
 *   npx tsx scripts/send-consultant-welcome.ts <emails.txt>            # dry run
 *   npx tsx scripts/send-consultant-welcome.ts <emails.txt> --confirm  # send
 *
 * Dry run by default, because the mistake this guards against — a real email to
 * a real consultant — cannot be taken back. Take a backup first:
 *   npx tsx scripts/backup-app-state.ts
 *
 * Three rules it follows:
 *
 *  • It only writes to people it can find. An address with no consultant record
 *    is reported and skipped, not emailed on a guess.
 *  • It greets with the WHOLE stored name. Roughly half these profiles are
 *    surname-first, so the automatic first-name greeting would open with
 *    "Bienvenue, Khenchouche." — correct-looking and wrong.
 *  • It stamps `welcomeEmailSentAt` on each success, which is the same flag the
 *    approval flow checks. Without it, the next admin approval would send a
 *    second welcome and a second 4 MB attachment.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

// Load .env.local before anything imports the store or the mailer — both read
// their credentials at call time, and a plain `npx tsx` gets no Next.js env
// loading. Same preamble the other operational scripts here use.
const ENV = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(ENV)) {
  for (const line of fs.readFileSync(ENV, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.trim().replace(/^["']|["']$/g, '');
  }
}

import { db } from '@/server/db/store';
import { sendConsultantWelcomeEmail } from '@/server/notifications/mock';

const CONFIRM = process.argv.includes('--confirm');
const LIST = process.argv.find((a) => !a.startsWith('--') && a.endsWith('.txt'));
const PORTAL_URL = 'https://metwork.dz/mentordashboard';
/** Gap between sends — Resend rate-limits, and this is not a race. */
const THROTTLE_MS = 700;

async function main(): Promise<void> {
  if (!LIST) {
    console.error('Usage: npx tsx scripts/send-consultant-welcome.ts <emails.txt> [--confirm]');
    process.exit(1);
  }

  const emails = fs
    .readFileSync(LIST, 'utf8')
    .split('\n')
    .map((l) => l.trim().toLowerCase())
    .filter((l) => l && !l.startsWith('#'));

  const data = await db.read();
  const mentors = data.mentors ?? [];

  const targets = emails.map((email) => {
    const mentor = mentors.find((m) => (m.email ?? '').trim().toLowerCase() === email);
    return { email, mentor };
  });

  const found = targets.filter((t) => t.mentor);
  const missing = targets.filter((t) => !t.mentor);
  const already = found.filter((t) => t.mentor!.welcomeEmailSentAt);
  const sendable = found.filter((t) => !t.mentor!.welcomeEmailSentAt);

  console.log(CONFIRM ? '⚠  LIVE SEND (--confirm)' : '🔎 DRY RUN — no email will be sent');
  console.log('');
  for (const t of sendable) {
    const m = t.mentor!;
    console.log(`  → ${(m.fullName ?? '(no name)').padEnd(30)} ${m.approvalStatus ?? '(legacy)'}  ${t.email}`);
  }
  for (const t of already) console.log(`  · already sent, skipping: ${t.email}`);
  for (const t of missing) console.log(`  ✘ no consultant record, skipping: ${t.email}`);
  console.log('');
  console.log(`  ${sendable.length} to send · ${already.length} already sent · ${missing.length} unmatched`);

  if (!CONFIRM) {
    console.log('');
    console.log('  Re-run with --confirm to send.');
    return;
  }

  let sent = 0;
  let failed = 0;
  for (const t of sendable) {
    const m = t.mentor!;
    const ok = await sendConsultantWelcomeEmail(t.email, {
      fullName: m.fullName ?? '',
      // The whole name, not its first token — see the header.
      greetingName: (m.fullName ?? '').trim() || null,
      portalUrl: PORTAL_URL,
    });
    if (ok) {
      // Stamp only on success: the flag prevents a duplicate, and a send that
      // never went out has nothing to deduplicate against.
      await db.update((d) => {
        const rec = (d.mentors ?? []).find((x) => x.id === m.id);
        if (rec) rec.welcomeEmailSentAt = new Date().toISOString();
      });
      sent += 1;
      console.log(`  ✔ ${t.email}`);
    } else {
      failed += 1;
      console.log(`  ✘ FAILED ${t.email}`);
    }
    await new Promise((r) => setTimeout(r, THROTTLE_MS));
  }

  console.log('');
  console.log(`  sent ${sent} · failed ${failed}`);
  if (failed) process.exitCode = 1;
}

void main();
