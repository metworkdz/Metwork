/**
 * Infobip HTTP API client.
 *
 * Sends OTP codes via WhatsApp (primary) or SMS (fallback).
 * Uses only the native fetch API — no heavy SDK dependency.
 *
 * Required env vars:
 *   INFOBIP_BASE_URL          — https://xxxxx.api.infobip.com  (no trailing slash)
 *   INFOBIP_API_KEY           — API key from the Infobip portal
 *   INFOBIP_SENDER            — SMS sender (phone number or alphanumeric ID)
 *   INFOBIP_WHATSAPP_SENDER   — WhatsApp Business Account (WABA) approved sender number
 *                               Falls back to INFOBIP_SENDER if not set, but WhatsApp
 *                               requires a WABA-registered number — set this separately.
 */

const OTP_MSG = (code: string) => `Your Metwork verification code is: ${code}`;

interface InfobipConfig {
  baseUrl: string;
  apiKey: string;
  smsSender: string;
  waSender: string;
}

function getConfig(): InfobipConfig | null {
  const baseUrl = process.env.INFOBIP_BASE_URL?.replace(/\/$/, '');
  const apiKey = process.env.INFOBIP_API_KEY;
  const smsSender = process.env.INFOBIP_SENDER;
  if (!baseUrl || !apiKey || !smsSender) return null;
  const waSender = process.env.INFOBIP_WHATSAPP_SENDER ?? smsSender;
  return { baseUrl, apiKey, smsSender, waSender };
}

/**
 * Send OTP via WhatsApp using the Infobip WhatsApp text message API.
 * Throws on API error so the caller can fall back to another channel.
 */
export async function sendWhatsAppOTP(phone: string, code: string): Promise<void> {
  const cfg = getConfig();
  if (!cfg) throw new Error('Infobip not configured: INFOBIP_BASE_URL, INFOBIP_API_KEY, INFOBIP_SENDER, INFOBIP_WHATSAPP_SENDER required');

  const res = await fetch(`${cfg.baseUrl}/whatsapp/1/message/text`, {
    method: 'POST',
    headers: {
      Authorization: `App ${cfg.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      from: cfg.waSender,
      to: phone,
      content: { text: OTP_MSG(code) },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Infobip WhatsApp error ${res.status}: ${body}`);
  }
}

/**
 * Send OTP via SMS using the Infobip SMS text/advanced API.
 * Throws on API error so the caller can fall back to another channel.
 */
export async function sendSMSOTP(phone: string, code: string): Promise<void> {
  const cfg = getConfig();
  if (!cfg) throw new Error('Infobip not configured: INFOBIP_BASE_URL, INFOBIP_API_KEY, INFOBIP_SENDER required');

  const res = await fetch(`${cfg.baseUrl}/sms/2/text/advanced`, {
    method: 'POST',
    headers: {
      Authorization: `App ${cfg.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      messages: [
        {
          from: cfg.smsSender,
          destinations: [{ to: phone }],
          text: OTP_MSG(code),
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Infobip SMS error ${res.status}: ${body}`);
  }
}
