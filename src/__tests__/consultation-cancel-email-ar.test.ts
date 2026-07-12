/**
 * Consultant-cancellation email localization (en / fr / ar).
 *
 * The cancel notice historically collapsed every non-en locale to French;
 * this locks in the three-locale copy map, the RTL wrapper for Arabic, and
 * the fr fallback for unknown locales.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendSpy = vi.fn((..._args: unknown[]) => Promise.resolve(true));
vi.mock('@/server/notifications/email', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/notifications/email')>();
  return { ...actual, sendResendEmail: (...args: unknown[]) => sendSpy(...args) };
});

import { sendConsultationCancelledEmail } from '@/server/notifications/mock';
import type { MentorBookingRecord, MentorRecord } from '@/server/db/store';

const booking = {
  id: 'b-1',
  userName: 'Amine',
  userEmail: 'amine@test.dz',
  userPhone: '',
  scheduledAt: null,
  consultationDate: '2026-07-15',
  consultationTime: '14:00',
} as unknown as MentorBookingRecord;

const mentor = { fullName: 'Sara Consultant', email: 's@test.dz' } as unknown as MentorRecord;

beforeEach(() => sendSpy.mockClear());

function sentHtml(): { subject: string; html: string } {
  expect(sendSpy).toHaveBeenCalledTimes(1);
  return sendSpy.mock.calls[0]![0] as unknown as { subject: string; html: string };
}

describe('sendConsultationCancelledEmail', () => {
  it('renders Arabic copy with dir="rtl"', () => {
    sendConsultationCancelledEmail({ booking, mentor, lang: 'ar', refundedAmount: 4500 });
    const { subject, html } = sentHtml();
    expect(subject).toContain('تم إلغاء الاستشارة');
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('4,500');
  });

  it('keeps the existing French copy with dir="ltr"', () => {
    sendConsultationCancelledEmail({ booking, mentor, lang: 'fr', refundedAmount: 0 });
    const { subject, html } = sentHtml();
    expect(subject).toContain('Consultation annulée');
    expect(html).toContain('dir="ltr"');
    expect(html).toContain('Aucun paiement');
  });

  it('keeps the existing English copy', () => {
    sendConsultationCancelledEmail({ booking, mentor, lang: 'en', refundedAmount: 100 });
    const { subject } = sentHtml();
    expect(subject).toContain('Consultation cancelled');
  });

  it('falls back to French for unknown locales', () => {
    sendConsultationCancelledEmail({ booking, mentor, lang: 'de', refundedAmount: 0 });
    const { subject } = sentHtml();
    expect(subject).toContain('Consultation annulée');
  });
});
