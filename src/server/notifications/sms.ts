/**
 * Twilio SMS transport.
 *
 * Lazily initialises the Twilio client on first use so the module is
 * safe to import even when TWILIO_* vars are not set (they just won't
 * be used because the dispatcher checks SMS_PROVIDER first).
 */
import twilio from 'twilio';

let _client: ReturnType<typeof twilio> | null = null;

function getClient(): ReturnType<typeof twilio> {
  if (_client) return _client;
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    throw new Error('TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set when SMS_PROVIDER=twilio');
  }
  _client = twilio(sid, token);
  return _client;
}

/**
 * Send an SMS via Twilio. Throws on API failure so the caller can
 * decide whether to surface the error or swallow it.
 */
export async function sendTwilioSms(to: string, body: string): Promise<void> {
  const from = process.env.TWILIO_PHONE_NUMBER;
  if (!from) {
    throw new Error('TWILIO_PHONE_NUMBER must be set when SMS_PROVIDER=twilio');
  }
  await getClient().messages.create({ to, from, body });
}
