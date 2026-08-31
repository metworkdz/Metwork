/**
 * Infobip recipient normalization.
 *
 * Every sender must put international digits (no '+', no spaces) in the
 * recipient field. This is not cosmetic: Infobip rejects a spaced recipient
 * outright with REJECTED_PREFIX_MISSING, which is how consultant OTP delivery
 * was silently failing for anyone whose phone was stored as "+213 770 53 53 46".
 *
 * Observed in the live Infobip logs before this fix:
 *   to="+213 770 53 53 46"  → REJECTED / REJECTED_PREFIX_MISSING
 *   to="213770535346"       → delivered
 *
 * The two booking templates already normalized; the OTP senders did not. These
 * tests pin ALL of them to the one shared rule so they can't drift apart again.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };
let fetchMock: ReturnType<typeof vi.fn>;

/** The `to` / destination this send put on the wire. */
function sentRecipient(): string {
  const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
  return body.messages
    ? (body.messages[0].destinations?.[0]?.to ?? body.messages[0].to)
    : body.to;
}

beforeEach(() => {
  vi.resetModules();
  process.env.INFOBIP_BASE_URL = 'https://example.api.infobip.com';
  process.env.INFOBIP_API_KEY = 'test-key';
  process.env.INFOBIP_SENDER = '+13027799398';
  process.env.INFOBIP_WHATSAPP_SENDER = '+13027799398';
  fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '{}' });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
});

/** Every stored shape of the same Algerian number must reach the wire identically. */
const EQUIVALENT_INPUTS = [
  '+213770535346',
  '+213 770 53 53 46',
  '213770535346',
  '0770535346',
  '0770 53 53 46',
  '770535346',
];

describe('Infobip recipient normalization', () => {
  describe('sendWhatsAppOTP — the OTP path that was broken', () => {
    for (const input of EQUIVALENT_INPUTS) {
      it(`normalizes ${JSON.stringify(input)} → "213770535346"`, async () => {
        const { sendWhatsAppOTP } = await import('@/lib/infobip');
        await sendWhatsAppOTP(input, '123456');
        expect(sentRecipient()).toBe('213770535346');
      });
    }

    it('never puts a space or a + on the wire', async () => {
      const { sendWhatsAppOTP } = await import('@/lib/infobip');
      await sendWhatsAppOTP('+213 770 53 53 46', '123456');
      const to = sentRecipient();
      expect(to).not.toMatch(/[\s+]/);
    });
  });

  describe('sendSMSOTP — same rule', () => {
    for (const input of ['+213 770 53 53 46', '0770535346']) {
      it(`normalizes ${JSON.stringify(input)}`, async () => {
        const { sendSMSOTP } = await import('@/lib/infobip');
        await sendSMSOTP(input, '123456');
        expect(sentRecipient()).toBe('213770535346');
      });
    }
  });

  describe('the other senders keep the same rule', () => {
    it('sendWhatsAppMessage', async () => {
      const { sendWhatsAppMessage } = await import('@/lib/infobip');
      await sendWhatsAppMessage('+213 770 53 53 46', 'hi');
      expect(sentRecipient()).toBe('213770535346');
    });

    it('sendSMSMessage', async () => {
      const { sendSMSMessage } = await import('@/lib/infobip');
      await sendSMSMessage('0770 53 53 46', 'hi');
      expect(sentRecipient()).toBe('213770535346');
    });

    it('sendWhatsAppNewBookingTemplate', async () => {
      const { sendWhatsAppNewBookingTemplate } = await import('@/lib/infobip');
      await sendWhatsAppNewBookingTemplate('+213 770 53 53 46', {
        firstName: 'A', date: 'D', time: 'T', duration: '60', type: 'En ligne', bookingRef: 'r1',
      });
      expect(sentRecipient()).toBe('213770535346');
    });

    it('sendWhatsAppIncubatorBookingTemplate', async () => {
      const { sendWhatsAppIncubatorBookingTemplate } = await import('@/lib/infobip');
      await sendWhatsAppIncubatorBookingTemplate('+213 770 53 53 46', {
        incubatorName: 'Inc', itemName: 'Item',
      });
      expect(sentRecipient()).toBe('213770535346');
    });
  });

  it('leaves the WhatsApp SENDER digits-only too (REJECTED_SOURCE guard)', async () => {
    const { sendWhatsAppOTP } = await import('@/lib/infobip');
    await sendWhatsAppOTP('213770535346', '123456');
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body.messages[0].from).toBe('13027799398');
  });
});
