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
 *   … --poster https://…/poster.png     attach the visual at the top
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { loadScriptEnv } from '../_env';

const TARGET = loadScriptEnv();

import { db } from '../../src/server/db/store';
import { communityManagerEmailHtml, SUBJECTS, type CampaignFacts } from './community-manager-email';

const SLUG = 'formation-devenir-un-community-manager';
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

async function facts(posterUrl: string | null): Promise<CampaignFacts> {
  const d = await db.read();
  const p = (d.programs ?? []).find((x) => x.slug === SLUG);
  if (!p) throw new Error(`Program "${SLUG}" not found on ${TARGET.label}`);

  const taken = (d.registrations ?? []).filter(
    (r) => r.entityId === p.id && r.status === 'CONFIRMED',
  ).length;
  const promo = (d.promoCodes ?? []).find((c) => c.code === 'METWORK10' && c.isActive);

  return {
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
    promo: promo
      ? { code: promo.code, percent: promo.discountPercent, maxUses: promo.usageLimit ?? null }
      : null,
    posterUrl,
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const preview = argv.includes('--preview');
  const posterIdx = argv.indexOf('--poster');
  const posterUrl = posterIdx >= 0 ? (argv[posterIdx + 1] ?? null) : null;
  // Skip the value that FOLLOWS --poster, but only when the flag is present:
  // with posterIdx at -1, `i !== posterIdx + 1` silently ate argument 0, so the
  // first recipient was dropped without a word.
  const posterValueIdx = posterIdx >= 0 ? posterIdx + 1 : -1;
  const recipients = argv.filter(
    (a, i) => a.includes('@') && !a.startsWith('--') && i !== posterValueIdx,
  );
  if (recipients.length === 0 && !preview) {
    console.error('✘ No recipient addresses given.');
  }

  console.log(`\n→ reading figures from ${TARGET.kind === 'local' ? 'LOCAL' : 'SUPABASE'}: ${TARGET.label}`);
  const f = await facts(posterUrl);
  const html = communityManagerEmailHtml(f);
  const subject = SUBJECTS[0]!;

  console.log(`\n  ${f.dates}${f.startTime ? ` · ${f.startTime}` : ''} · ${f.city}`);
  console.log(`  ${f.onlinePrice} by card / ${f.cashPrice} cash` + (f.deposit ? ` · deposit ${f.deposit}` : ''));
  console.log(`  ${f.seatsLeft} seat(s) left · closes ${f.deadline}`);
  console.log(`  promo: ${f.promo ? `${f.promo.code} −${f.promo.percent}% (max ${f.promo.maxUses ?? '∞'})` : 'none'}`);
  console.log(`  poster: ${posterUrl ?? '(none — pass --poster <url>)'}`);
  console.log(`\n  subject: ${subject}`);

  const out = path.resolve('campaign-preview.html');
  fs.writeFileSync(out, html);
  console.log(`  preview written → ${out}`);

  if (preview || recipients.length === 0) {
    console.log('\nPREVIEW ONLY — no email sent. Pass one or more addresses to send.');
    return;
  }

  const { key, from } = mailerCreds();
  if (!key) {
    console.error('✘ RESEND_API_KEY missing from .env.local — cannot send.');
    process.exit(1);
  }

  const { Resend } = await import('resend');
  const resend = new Resend(key);

  console.log(`\n  sending as ${from}`);
  for (const to of recipients) {
    const { error } = await resend.emails.send({ from, to, subject, html });
    console.log(error ? `  ✘ ${to} — ${error.name}: ${error.message}` : `  ✅ ${to}`);
  }
}

if (process.argv[1]?.includes('send-community-manager-email')) {
  void main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
