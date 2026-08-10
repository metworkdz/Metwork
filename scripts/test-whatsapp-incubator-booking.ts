/**
 * Live smoke test for the Infobip WhatsApp "incubator_booking" template —
 * sends a REAL message to a REAL phone number. Mirrors the exact request
 * built by `sendWhatsAppIncubatorBookingTemplate` in src/lib/infobip.ts,
 * kept self-contained (no `@/` imports — tsx doesn't resolve tsconfig paths
 * for standalone scripts, same convention as scripts/backup-app-state.ts).
 *
 * NOTE: as of 2026-08-10 this template is submitted to Meta but NOT YET
 * APPROVED — a rejection here (e.g. "template not found" / not paired to an
 * approved template) is EXPECTED until approval lands. This script exists so
 * you can re-run it once Meta approves it and confirm delivery immediately,
 * without writing a new one.
 *
 * Creds are read from /Users/macbookpro/Downloads/metwork/.env.local.
 *
 * Run: npx tsx scripts/test-whatsapp-incubator-booking.ts +213XXXXXXXXX
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

// ── Load Infobip creds from the repo's .env.local ──────────────────────────
const MAIN_ENV = path.resolve(process.cwd(), '.env.local');
if (!fs.existsSync(MAIN_ENV)) {
  console.error(`✘ ${MAIN_ENV} not found — no Infobip creds available.`);
  process.exit(1);
}
const envContent = fs.readFileSync(MAIN_ENV, 'utf8');
const envMap: Record<string, string> = {};
for (const line of envContent.split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) envMap[m[1]!] = m[2]!.trim().replace(/^['"]|['"]$/g, '');
}

const BASE_URL = envMap.INFOBIP_BASE_URL?.replace(/\/$/, '');
const API_KEY = envMap.INFOBIP_API_KEY;
const SMS_SENDER = envMap.INFOBIP_SENDER;
const WA_SENDER = (envMap.INFOBIP_WHATSAPP_SENDER || SMS_SENDER || '').replace(/^\+/, '');
const TEMPLATE_NAME = envMap.INFOBIP_WHATSAPP_INCUBATOR_BOOKING_TEMPLATE?.trim() || 'incubator_booking';
const LANGUAGE = envMap.INFOBIP_WHATSAPP_INCUBATOR_BOOKING_LANG?.trim() || 'fr';

if (!BASE_URL || !API_KEY || !SMS_SENDER || !WA_SENDER) {
  console.error('✘ Missing one of INFOBIP_BASE_URL / INFOBIP_API_KEY / INFOBIP_SENDER / INFOBIP_WHATSAPP_SENDER in .env.local');
  process.exit(1);
}

const phoneArg = process.argv[2];
if (!phoneArg) {
  console.error('Usage: npx tsx scripts/test-whatsapp-incubator-booking.ts <phone-number>');
  console.error('  e.g. npx tsx scripts/test-whatsapp-incubator-booking.ts +213549XXXXXX');
  process.exit(1);
}
const recipient = phoneArg.replace(/\D/g, '');
if (recipient.length < 8) {
  console.error(`✘ "${phoneArg}" doesn't look like a phone number after stripping non-digits (got "${recipient}").`);
  process.exit(1);
}

async function main() {
  console.log('── incubator_booking WhatsApp template — live smoke test ──────');
  console.log(`  Base URL     : ${BASE_URL}`);
  console.log(`  WA sender    : ${WA_SENDER}`);
  console.log(`  Template     : ${TEMPLATE_NAME} (${LANGUAGE})`);
  console.log(`  Recipient    : ${recipient}`);
  console.log('────────────────────────────────────────────────────────────');

  const res = await fetch(`${BASE_URL}/whatsapp/1/message/template`, {
    method: 'POST',
    headers: {
      Authorization: `App ${API_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      messages: [
        {
          from: WA_SENDER,
          to: recipient,
          content: {
            templateName: TEMPLATE_NAME,
            templateData: {
              body: { placeholders: ['Metwork Test Incubator', 'Bureau privé — Test'] },
            },
            language: LANGUAGE,
          },
        },
      ],
    }),
  });

  const bodyText = await res.text();
  let bodyJson: unknown;
  try { bodyJson = JSON.parse(bodyText); } catch { bodyJson = bodyText; }

  if (res.ok) {
    console.log(`✔ Infobip accepted the send — HTTP ${res.status}`);
    console.log(JSON.stringify(bodyJson, null, 2));
    console.log('\nCheck the recipient phone for the WhatsApp message.');
  } else {
    console.error(`✘ Infobip rejected the send — HTTP ${res.status}`);
    console.error(JSON.stringify(bodyJson, null, 2));
    console.error('\nIf the error mentions the template not existing / not approved,');
    console.error('this is EXPECTED until Meta finishes approving "incubator_booking".');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('✘ Request failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
