/**
 * Consultant OTP delivery — parallel fan-out (phone AND email) and the
 * channel→verification semantics it feeds.
 *
 * Email must ALWAYS be attempted when an address is on file: SMS to Algeria is
 * accepted by Infobip then silently expires undelivered, so a stop-at-first-
 * success chain left the consultant with nothing. The phone side still degrades
 * WhatsApp → SMS (alternatives to each other), the SAME code goes everywhere,
 * the code is never printed in production, and the RETURNED channel keeps its
 * old priority order so phoneVerified/emailVerified semantics are unchanged.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

const waMock = vi.fn();
const smsMock = vi.fn();
const emailMock = vi.fn();

vi.mock('@/lib/infobip', () => ({
  sendWhatsAppOTP: (...a: unknown[]) => waMock(...a),
  sendSMSOTP: (...a: unknown[]) => smsMock(...a),
  sendSMSMessage: vi.fn(),
  sendWhatsAppMessage: vi.fn(),
  sendWhatsAppNewBookingTemplate: vi.fn(),
  sendWhatsAppIncubatorBookingTemplate: vi.fn(),
}));

vi.mock('@/server/notifications/email', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/server/notifications/email');
  return { ...actual, sendResendEmail: (...a: unknown[]) => emailMock(...a) };
});

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  waMock.mockReset();
  smsMock.mockReset();
  emailMock.mockReset();
  process.env.SMS_PROVIDER = 'infobip';
  // 'test' — the senders only short-circuit on the literal 'production'.
  (process.env as Record<string, string | undefined>).NODE_ENV = 'test';
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

async function load() {
  return import('@/server/notifications/mock');
}

const OPTS = { email: 'c@example.com', phone: '+213555000111', code: '123456' };

describe('sendConsultantOtp — parallel fan-out', () => {
  it('sends WhatsApp AND email together when both work', async () => {
    waMock.mockResolvedValue(undefined);
    emailMock.mockResolvedValue(true);
    const { sendConsultantOtp } = await load();

    const channel = await sendConsultantOtp(OPTS);

    // Reported channel keeps the old priority order (phone wins) …
    expect(channel).toBe('whatsapp');
    expect(waMock).toHaveBeenCalledTimes(1);
    // … but email is no longer skipped. This is the regression that stranded
    // consultants when the phone channel "succeeded" without delivering.
    expect(emailMock).toHaveBeenCalledTimes(1);
    // SMS is WhatsApp's fallback, so a healthy WhatsApp must not burn one.
    expect(smsMock).not.toHaveBeenCalled();
  });

  it('falls back to SMS when WhatsApp fails, and still emails', async () => {
    waMock.mockRejectedValue(new Error('template rejected'));
    smsMock.mockResolvedValue(undefined);
    emailMock.mockResolvedValue(true);
    const { sendConsultantOtp } = await load();

    const channel = await sendConsultantOtp(OPTS);

    expect(channel).toBe('sms');
    expect(waMock).toHaveBeenCalledTimes(1);
    expect(smsMock).toHaveBeenCalledTimes(1);
    expect(emailMock).toHaveBeenCalledTimes(1);
  });

  it('still emails when the phone channels report success — the Algeria SMS trap', async () => {
    // Infobip accepts an Algerian SMS (HTTP 200) and then never delivers it.
    // Email must go out regardless, or the consultant gets nothing at all.
    waMock.mockRejectedValue(new Error('no whatsapp account'));
    smsMock.mockResolvedValue(undefined);
    emailMock.mockResolvedValue(true);
    const { sendConsultantOtp } = await load();

    await sendConsultantOtp(OPTS);

    expect(emailMock).toHaveBeenCalledTimes(1);
  });

  it('reports email when both phone channels fail', async () => {
    waMock.mockRejectedValue(new Error('wa down'));
    smsMock.mockRejectedValue(new Error('sms down'));
    emailMock.mockResolvedValue(true);
    const { sendConsultantOtp } = await load();

    const channel = await sendConsultantOtp(OPTS);

    expect(channel).toBe('email');
    expect(emailMock).toHaveBeenCalledTimes(1);
  });

  it('reports null when every channel fails', async () => {
    waMock.mockRejectedValue(new Error('x'));
    smsMock.mockRejectedValue(new Error('x'));
    emailMock.mockRejectedValue(new Error('x'));
    const { sendConsultantOtp } = await load();

    expect(await sendConsultantOtp(OPTS)).toBeNull();
  });

  it('sends the SAME code to every attempted channel — never a fresh one', async () => {
    waMock.mockRejectedValue(new Error('x'));
    smsMock.mockRejectedValue(new Error('x'));
    emailMock.mockResolvedValue(true);
    const { sendConsultantOtp } = await load();

    await sendConsultantOtp(OPTS);

    expect(waMock).toHaveBeenCalledWith(OPTS.phone, '123456');
    expect(smsMock).toHaveBeenCalledWith(OPTS.phone, '123456');
    const emailArg = emailMock.mock.calls[0]?.[0] as { subject: string };
    expect(emailArg.subject).toContain('123456');
  });

  it('skips phone channels entirely when no phone is on file', async () => {
    emailMock.mockResolvedValue(true);
    const { sendConsultantOtp } = await load();

    const channel = await sendConsultantOtp({ ...OPTS, phone: null });

    expect(channel).toBe('email');
    expect(waMock).not.toHaveBeenCalled();
    expect(smsMock).not.toHaveBeenCalled();
  });

  it('never logs the OTP code in production', async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    delete process.env.SMS_PROVIDER; // exercise the mock branches that used to print it
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    emailMock.mockResolvedValue(false); // Resend unconfigured

    const { sendConsultantOtp } = await load();
    await sendConsultantOtp(OPTS);

    const printed = [...logSpy.mock.calls, ...errSpy.mock.calls].flat().join(' ');
    expect(printed).not.toContain('123456');
    logSpy.mockRestore();
    errSpy.mockRestore();
  });
});
