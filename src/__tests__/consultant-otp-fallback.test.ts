/**
 * Consultant OTP delivery — strict sequential fallback (WhatsApp → SMS → email)
 * and the channel→verification semantics it feeds.
 *
 * The chain must STOP at the first channel that succeeds, must reuse the SAME
 * code for every attempt, and must never print the code in production. The
 * channel it lands on decides which contact detail a confirmed code proves.
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

describe('sendConsultantOtp — strict sequential fallback', () => {
  it('stops at WhatsApp when it succeeds', async () => {
    waMock.mockResolvedValue(undefined);
    const { sendConsultantOtp } = await load();

    const channel = await sendConsultantOtp(OPTS);

    expect(channel).toBe('whatsapp');
    expect(waMock).toHaveBeenCalledTimes(1);
    // The whole point of sequential: the later channels are NOT attempted.
    expect(smsMock).not.toHaveBeenCalled();
    expect(emailMock).not.toHaveBeenCalled();
  });

  it('falls through to SMS when WhatsApp fails, and stops there', async () => {
    waMock.mockRejectedValue(new Error('template rejected'));
    smsMock.mockResolvedValue(undefined);
    const { sendConsultantOtp } = await load();

    const channel = await sendConsultantOtp(OPTS);

    expect(channel).toBe('sms');
    expect(waMock).toHaveBeenCalledTimes(1);
    expect(smsMock).toHaveBeenCalledTimes(1);
    expect(emailMock).not.toHaveBeenCalled();
  });

  it('falls through to email when both phone channels fail', async () => {
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
