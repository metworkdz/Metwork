/**
 * Send the "Devenir un Community Manager" campaign email.
 *
 * Recipients are ONLY ever the addresses passed on the command line. This
 * script deliberately cannot read the member list — a mailshot script that can
 * address a database is one typo away from mailing it, so the blast stays a
 * conscious act performed somewhere with an unsubscribe list and a send log.
 *
 * Every figure in the email (price, deposit, seats left, dates, promo) is read
 * from PRODUCTION at send time rather than hardcoded, so the message can never
 * quote a number the registration page contradicts.
 *
 *   npx tsx scripts/campaigns/send-community-manager-email.ts --preview
 *   npx tsx scripts/campaigns/send-community-manager-email.ts a@x.dz b@y.dz
 *   … --list recipients.txt             one address per line
 *   … --dry-run                         validate the list, send nothing
 *   … --poster https://…/poster.png     attach the visual at the top
 *   … --delay 700                       ms between sends (default 700)
 *
 * A send APPENDS to `campaign-send-log.csv` and skips any address already
 * logged as sent. That makes the run resumable: if the daily quota cuts it
 * off at address 60, re-running tomorrow picks up at 61 instead of mailing
 * the first 60 people twice.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { loadScriptEnv } from '../_env';

const TARGET = loadScriptEnv();

import { db } from '../../src/server/db/store';
import {
  communityManagerEmailHtml,
  communityManagerEmailText,
  emailPosterUrl,
  SUBJECTS,
  UNSUBSCRIBE_MAILBOX,
  type CampaignFacts,
} from './community-manager-email';

const SLUG = 'formation-devenir-un-community-manager';
const PROMO_CODE = 'METWORK10';
const REGISTER_URL = `https://metwork.dz/programs/${SLUG}`;

/** Read RESEND_API_KEY / EMAIL_FROM straight from .env.local, like the backup script. */
function mailerCreds(): { key: string; from: string } {
  const file = path.resolve(process.cwd(), '.env.local');
  const map: Record<string, string> = {};
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m) map[m[1]!] = m[2]!.trim().replace(/^['"]|['"]$/g, '');
    }
  }
  const key = process.env.RESEND_API_KEY ?? map.RESEND_API_KEY ?? '';
  const from = process.env.EMAIL_FROM ?? map.EMAIL_FROM ?? 'Metwork <noreply@metwork.dz>';
  return { key, from };
}

const FR_MONTHS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

/** "29 – 30 septembre & 1er octobre" from a start/end date, in UTC. */
function humanDateRange(startIso: string, endIso: string): string {
  const s = new Date(startIso);
  const e = new Date(endIso);
  const day = (d: Date) => (d.getUTCDate() === 1 ? '1er' : String(d.getUTCDate()));
  const month = (d: Date) => FR_MONTHS[d.getUTCMonth()]!;
  if (month(s) === month(e)) return `${day(s)} – ${day(e)} ${month(s)}`;
  // Spans two months: name both, and let the middle day sit with the first.
  const mid = new Date(s);
  mid.setUTCDate(s.getUTCDate() + 1);
  const midPart = mid < e ? ` – ${day(mid)}` : '';
  return `${day(s)}${midPart} ${month(s)} & ${day(e)} ${month(e)}`;
}

function humanDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCDate() === 1 ? '1er' : d.getUTCDate()} ${FR_MONTHS[d.getUTCMonth()]}`;
}

/** Title-case a city stored however the host typed it ("oran" → "Oran"). */
function city(raw: string): string {
  return raw.trim().replace(/\S+/g, (w) => w[0]!.toUpperCase() + w.slice(1).toLowerCase());
}

/**
 * The live state of the advertised promo code.
 *
 * Read defensively: the admin UI writes `expiresAt` / `usageLimit` /
 * `usedCount`, while the checkout validator also honours the older
 * `validUntil` / `maxUses` / `useCount` spellings. Reading only one set would
 * mean advertising a code that checkout has already retired.
 *
 * Returns `{ promo, warning }` rather than silently dropping a dead code — the
 * operator gets told, instead of discovering it from a customer.
 */
function readPromo(codes: unknown[]): {
  promo: CampaignFacts['promo'];
  warning: string | null;
} {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const c = (codes as any[]).find((x) => x?.code === PROMO_CODE);
  if (!c) return { promo: null, warning: `${PROMO_CODE} does not exist in this database.` };

  const percent: number =
    c.discountPercent ?? (c.discountType === 'PERCENTAGE' ? c.discountValue : 0);
  const expiresIso: string | null = c.validUntil ?? c.expiresAt ?? null;
  const limit: number | null = c.maxUses ?? c.usageLimit ?? null;
  const used: number = c.useCount ?? c.usedCount ?? 0;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const remainingUses = limit === null ? null : Math.max(0, limit - used);
  const promo = {
    code: PROMO_CODE,
    percent,
    remainingUses,
    expires: expiresIso ? humanDate(expiresIso) : null,
  };

  // Anything checkout would refuse is worth shouting about BEFORE the send.
  if (!c.isActive) return { promo, warning: `${PROMO_CODE} is switched OFF — checkout will refuse it.` };
  if (expiresIso && expiresIso < new Date().toISOString())
    return { promo, warning: `${PROMO_CODE} EXPIRED on ${expiresIso.slice(0, 10)} — checkout will refuse it.` };
  if (remainingUses === 0)
    return { promo, warning: `${PROMO_CODE} has no uses left (${used}/${limit}) — checkout will refuse it.` };
  if (!percent) return { promo, warning: `${PROMO_CODE} discounts 0 % — the block would promise nothing.` };
  return { promo, warning: null };
}

async function facts(posterUrl: string | null): Promise<{
  facts: CampaignFacts;
  promoWarning: string | null;
}> {
  const d = await db.read();
  const p = (d.programs ?? []).find((x) => x.slug === SLUG);
  if (!p) throw new Error(`Program "${SLUG}" not found on ${TARGET.label}`);

  const taken = (d.registrations ?? []).filter(
    (r) => r.entityId === p.id && r.status === 'CONFIRMED',
  ).length;
  const { promo, warning } = readPromo(d.promoCodes ?? []);
  return {
    promoWarning: warning,
    facts: {
      registerUrl: REGISTER_URL,
      dates: humanDateRange(p.startDate, p.endDate),
      startTime: p.startTime ?? null,
      city: city(p.city),
      trainerName: 'Naouel Salhi',
      trainerTitle: 'Social Media Specialist',
      onlinePrice: p.onlinePrice ?? p.price,
      cashPrice: p.cashPrice ?? p.price,
      deposit: p.cashDepositType === 'FIXED' ? (p.cashDepositValue ?? null) : null,
      seatsLeft: Math.max(0, p.seatsTotal - taken),
      deadline: humanDate(p.deadline),
      promo,
      // Default to the program's OWN cover — it is already hosted and is the
      // poster the host uploaded, so there is nothing to pass by hand.
      // `--poster` overrides it when a different visual is wanted.
      posterUrl: posterUrl ?? p.imageUrl ?? p.imageUrls?.[0] ?? null,
    },
  };
}

/* ───────────────────────────── the recipient list ───────────────────────── */

const LOG_FILE = path.resolve('campaign-send-log.csv');
const ADDRESS = /^[^\s@,;]+@[^\s@,;]+\.[A-Za-z]{2,}$/;

interface Rejected { address: string; why: string }

/**
 * Clean a list of addresses and separate the ones that cannot be delivered.
 *
 * A hard bounce is not a free mistake: mailbox providers read a sender's
 * bounce rate as a signal that the sender does not know who it is mailing,
 * and the penalty lands on the whole domain. Catching a typo here costs a DNS
 * lookup; catching it at send time costs reputation that also carries the
 * platform's OTP codes and booking confirmations.
 */
async function cleanList(raw: string[]): Promise<{ send: string[]; rejected: Rejected[] }> {
  const rejected: Rejected[] = [];
  const seen = new Set<string>();
  const candidates: string[] = [];

  for (const entry of raw) {
    const address = entry.trim().toLowerCase();
    if (!address || address.startsWith('#')) continue;
    if (!ADDRESS.test(address)) { rejected.push({ address: entry.trim(), why: 'malformed address' }); continue; }
    if (seen.has(address)) { rejected.push({ address, why: 'duplicate' }); continue; }
    seen.add(address);
    candidates.push(address);
  }

  // One MX lookup per DOMAIN, not per address — 92 gmail.com addresses are one
  // question. A domain publishing a null MX ("0 .") is explicitly refusing all
  // mail, which is a guaranteed bounce rather than a maybe.
  const dns = await import('node:dns/promises');
  const domains = [...new Set(candidates.map((a) => a.slice(a.lastIndexOf('@') + 1)))];
  const deliverable = new Map<string, string | null>();
  await Promise.all(
    domains.map(async (domain) => {
      try {
        const mx = await dns.resolveMx(domain);
        const real = mx.filter((r) => r.exchange && r.exchange !== '.' && r.exchange !== '');
        deliverable.set(domain, real.length ? null : 'domain refuses all mail (null MX)');
      } catch {
        try {
          await dns.resolve(domain, 'A');
          deliverable.set(domain, null); // No MX but an A record — legal fallback.
        } catch {
          deliverable.set(domain, 'domain does not exist');
        }
      }
    }),
  );

  const send: string[] = [];
  for (const address of candidates) {
    const why = deliverable.get(address.slice(address.lastIndexOf('@') + 1));
    if (why) rejected.push({ address, why });
    else send.push(address);
  }
  return { send, rejected };
}

/** Addresses this campaign has already been sent to, from the log. */
function alreadySent(): Set<string> {
  if (!fs.existsSync(LOG_FILE)) return new Set();
  const done = new Set<string>();
  for (const line of fs.readFileSync(LOG_FILE, 'utf8').split('\n')) {
    const [, address, status] = line.split(',');
    if (address && status === 'sent') done.add(address.trim().toLowerCase());
  }
  return done;
}

function log(address: string, status: 'sent' | 'failed', detail: string): void {
  if (!fs.existsSync(LOG_FILE)) fs.writeFileSync(LOG_FILE, 'timestamp,address,status,detail\n');
  fs.appendFileSync(LOG_FILE, `${new Date().toISOString()},${address},${status},"${detail.replace(/"/g, "'")}"\n`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ─────────────────────────────────── main ───────────────────────────────── */

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flagValue = (name: string): string | null => {
    const i = argv.indexOf(name);
    return i >= 0 ? (argv[i + 1] ?? null) : null;
  };
  const preview = argv.includes('--preview');
  const dryRun = argv.includes('--dry-run');
  const posterUrl = flagValue('--poster');
  const listFile = flagValue('--list');
  const delayMs = Number(flagValue('--delay') ?? 700);

  // Skip any argument that is the VALUE of a flag, so a path or a URL is never
  // mistaken for a recipient.
  const valueIndexes = new Set(
    ['--poster', '--list', '--delay'].map((f) => argv.indexOf(f)).filter((i) => i >= 0).map((i) => i + 1),
  );
  const fromArgv = argv.filter((a, i) => a.includes('@') && !a.startsWith('--') && !valueIndexes.has(i));
  const fromFile = listFile ? fs.readFileSync(path.resolve(listFile), 'utf8').split('\n') : [];

  console.log(`\n→ reading figures from ${TARGET.kind === 'local' ? 'LOCAL' : 'SUPABASE'}: ${TARGET.label}`);
  const { facts: f, promoWarning } = await facts(posterUrl);
  const html = communityManagerEmailHtml(f);
  const text = communityManagerEmailText(f);
  const subject = SUBJECTS[0]!;

  console.log(`\n  ${f.dates}${f.startTime ? ` · ${f.startTime}` : ''} · ${f.city}`);
  console.log(`  ${f.onlinePrice} by card / ${f.cashPrice} cash` + (f.deposit ? ` · deposit ${f.deposit}` : ''));
  console.log(`  ${f.seatsLeft} seat(s) left · closes ${f.deadline}`);
  console.log(
    `  promo: ${
      f.promo
        ? `${f.promo.code} −${f.promo.percent}% · ${f.promo.remainingUses ?? '∞'} use(s) left` +
          (f.promo.expires ? ` · until ${f.promo.expires}` : '')
        : 'none'
    }`,
  );
  console.log(`  poster: ${f.posterUrl ? emailPosterUrl(f.posterUrl) : '(none)'}`);
  if (promoWarning) console.log(`\n  ⚠  ${promoWarning}`);
  console.log(`\n  subject: ${subject}`);

  const out = path.resolve('campaign-preview.html');
  fs.writeFileSync(out, html);
  console.log(`  preview written → ${out}`);

  const { send: clean, rejected } = await cleanList([...fromArgv, ...fromFile]);
  const done = alreadySent();
  const queue = clean.filter((a) => !done.has(a));

  if (rejected.length) {
    console.log(`\n  ✘ ${rejected.length} address(es) NOT mailable:`);
    for (const r of rejected) console.log(`      ${r.address} — ${r.why}`);
  }
  if (clean.length - queue.length > 0) {
    console.log(`\n  ↷ ${clean.length - queue.length} already sent in an earlier run — skipping.`);
  }
  console.log(`\n  ${queue.length} to send.`);

  if (preview || dryRun || queue.length === 0) {
    console.log(`\n${dryRun ? 'DRY RUN' : 'PREVIEW ONLY'} — nothing sent.`);
    return;
  }

  const { key, from } = mailerCreds();
  if (!key) {
    console.error('✘ RESEND_API_KEY missing from .env.local — cannot send.');
    process.exit(1);
  }

  const { Resend } = await import('resend');
  const resend = new Resend(key);

  console.log(`  sending as ${from} · reply-to ${UNSUBSCRIBE_MAILBOX} · ${delayMs}ms apart\n`);
  const sent: string[] = [];
  const failed: Array<{ address: string; why: string }> = [];

  for (const [i, to] of queue.entries()) {
    let lastError = '';
    // One retry, because a 429 or a 5xx is the network having a bad second,
    // not a bad address — and giving up on it would look like a bounce.
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const { data, error } = await resend.emails.send({
        from,
        to,
        subject,
        html,
        text,
        replyTo: UNSUBSCRIBE_MAILBOX,
        headers: {
          // RFC 2369. The visible footer link says the same thing; this is the
          // one the mail client turns into its own "Unsubscribe" button, which
          // is the button people press INSTEAD of "Report spam".
          'List-Unsubscribe': `<mailto:${UNSUBSCRIBE_MAILBOX}?subject=Desabonnement>`,
        },
      });
      if (!error) {
        sent.push(to);
        log(to, 'sent', data?.id ?? '');
        console.log(`  ✅ ${String(i + 1).padStart(3)} ${to}`);
        break;
      }
      lastError = `${error.name}: ${error.message}`;
      const transient = /rate|429|5\d\d|timeout|network/i.test(lastError);
      if (attempt === 1 && transient) { await sleep(2_000); continue; }
      failed.push({ address: to, why: lastError });
      log(to, 'failed', lastError);
      console.log(`  ✘ ${String(i + 1).padStart(3)} ${to} — ${lastError}`);
      break;
    }
    if (i < queue.length - 1) await sleep(delayMs);
  }

  console.log(`\n──────── RESULT ────────`);
  console.log(`  accepted by Resend : ${sent.length}`);
  console.log(`  rejected at send   : ${failed.length}`);
  console.log(`  not mailable       : ${rejected.length}`);
  for (const x of failed) console.log(`      ✘ ${x.address} — ${x.why}`);
  console.log(`\n  log → ${LOG_FILE}`);
  console.log(
    `\n  NOTE: "accepted" means Resend took the message, not that it reached\n` +
      `  an inbox. Bounces and complaints arrive afterwards — read them in the\n` +
      `  Resend dashboard before mailing this list again.`,
  );
}

if (process.argv[1]?.includes('send-community-manager-email')) {
  void main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
