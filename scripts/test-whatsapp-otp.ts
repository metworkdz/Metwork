/**
 * Live smoke test for the Infobip WhatsApp OTP send — sends a REAL message
 * to a REAL phone number using the approved `metwork_otp` template. Mirrors
 * the exact request built by `sendWhatsAppOTP` in src/lib/infobip.ts, kept
 * self-contained (no `@/` imports — tsx doesn't resolve tsconfig paths for
 * standalone scripts, same convention as scripts/backup-app-state.ts).
 *
 * Creds are read from /Users/macbookpro/Downloads/metwork/.env.local.
 *
 * Run: npx tsx scripts/test-whatsapp-otp.ts +213XXXXXXXXX
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
const TEMPLATE_NAME = envMap.INFOBIP_WHATSAPP_OTP_TEMPLATE?.trim() || 'metwork_otp';
const LANGUAGE = envMap.INFOBIP_WHATSAPP_OTP_LANG?.trim() || 'en_GB';

if (!BASE_URL || !API_KEY || !SMS_SENDER || !WA_SENDER) {
  console.error('✘ Missing one of INFOBIP_BASE_URL / INFOBIP_API_KEY / INFOBIP_SENDER / INFOBIP_WHATSAPP_SENDER in .env.local');
  process.exit(1);
}

const phoneArg = process.argv[2];
if (!phoneArg) {
  console.error('Usage: npx tsx scripts/test-whatsapp-otp.ts <phone-number>');
  console.error('  e.g. npx tsx scripts/test-whatsapp-otp.ts +213549XXXXXX');
  process.exit(1);
}
const recipient = phoneArg.replace(/\D/g, '');
if (recipient.length < 8) {
  console.error(`✘ "${phoneArg}" doesn't look like a phone number after stripping non-digits (got "${recipient}").`);
  process.exit(1);
}

const code = String(Math.floor(100000 + Math.random() * 900000));

async function main() {
  console.log('── WhatsApp OTP live smoke test ──────────────────────────────');
  console.log(`  Base URL     : ${BASE_URL}`);
  console.log(`  WA sender    : ${WA_SENDER}`);
  console.log(`  Template     : ${TEMPLATE_NAME} (${LANGUAGE})`);
  console.log(`  Recipient    : ${recipient}`);
  console.log(`  Test code    : ${code}`);
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
              body: { placeholders: [code] },
              buttons: [{ type: 'URL', parameter: code }],
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
    console.log('\nCheck the recipient phone for the WhatsApp message. A message');
    console.log('being ACCEPTED here does not guarantee delivery — Meta can still');
    console.log('reject/drop it downstream (e.g. unapproved template, opted-out user).');
  } else {
    console.error(`✘ Infobip rejected the send — HTTP ${res.status}`);
    console.error(JSON.stringify(bodyJson, null, 2));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('✘ Request failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
