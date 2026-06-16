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
 *
 * Optional (WhatsApp OTP template — business-initiated OTP requires a template):
 *   INFOBIP_WHATSAPP_OTP_TEMPLATE — approved Authentication template name
 *                                   (default 'metwork_otp')
 *   INFOBIP_WHATSAPP_OTP_LANG     — that template's exact language tag
 *                                   (default 'en_GB' — the approved metwork_otp
 *                                   template's language; override if it changes)
 */

const OTP_MSG = (code: string) => `Your Metwork verification code is: ${code}`;

/**
 * Send any custom text message via WhatsApp (Infobip).
 * Used for transactional notifications (e.g. consultation approvals).
 * Throws on API error so the caller can fall back gracefully.
 */
export async function sendWhatsAppMessage(phone: string, text: string): Promise<void> {
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
      content: { text },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Infobip WhatsApp error ${res.status}: ${body}`);
  }
}

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
  // WhatsApp rejects a sender with a leading '+' (REJECTED_SOURCE / "Invalid
  // Source address") — the WABA sender is registered digits-only. Strip it so
  // the env var works whether stored as +1XXXX or 1XXXX.
  const waSender = (process.env.INFOBIP_WHATSAPP_SENDER ?? smsSender).replace(/^\+/, '');
  return { baseUrl, apiKey, smsSender, waSender };
}

/**
 * Send OTP via WhatsApp using an approved Meta AUTHENTICATION template.
 *
 * Business-initiated WhatsApp messages (an unprompted OTP) MUST use a
 * pre-approved template — the free-form text endpoint only delivers inside the
 * 24-hour customer-service window, so it is rejected for OTP. The template's
 * body takes the code as its single placeholder, and its copy-code button is
 * sent as a `URL` button whose `parameter` is the same code (Meta convention,
 * mirrored by Infobip).
 *
 * Template name + language are env-configurable so they can change without a
 * redeploy:
 *   INFOBIP_WHATSAPP_OTP_TEMPLATE  default 'metwork_otp'
 *   INFOBIP_WHATSAPP_OTP_LANG      default 'en' — MUST equal the exact language
 *                                  tag of the approved template (e.g. 'en',
 *                                  'en_US', 'en_GB'); a mismatch is rejected.
 *
 * Throws on API error so the caller can fall back to another channel.
 */
export async function sendWhatsAppOTP(phone: string, code: string): Promise<void> {
  const cfg = getConfig();
  if (!cfg) throw new Error('Infobip not configured: INFOBIP_BASE_URL, INFOBIP_API_KEY, INFOBIP_SENDER, INFOBIP_WHATSAPP_SENDER required');

  const templateName = process.env.INFOBIP_WHATSAPP_OTP_TEMPLATE?.trim() || 'metwork_otp';
  // Default matches the approved 'metwork_otp' template's language tag (en_GB).
  const language = process.env.INFOBIP_WHATSAPP_OTP_LANG?.trim() || 'en_GB';

  const res = await fetch(`${cfg.baseUrl}/whatsapp/1/message/template`, {
    method: 'POST',
    headers: {
      Authorization: `App ${cfg.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      messages: [
        {
          from: cfg.waSender,
          to: phone,
          content: {
            templateName,
            templateData: {
              body: { placeholders: [code] },
              // Authentication copy-code button: a URL button whose parameter
              // is the verification code (Meta/Infobip convention for OTP).
              buttons: [{ type: 'URL', parameter: code }],
            },
            language,
          },
        },
      ],
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
