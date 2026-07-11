/**
 * Localized consultation confirmation emails (en / fr / ar).
 *
 *  1. The two templates (client "ready" + consultant "new booking") render the
 *     EXACT confirmed date + start time + duration + link/offline notice, in the
 *     requested locale, with dir="rtl" for Arabic.
 *  2. The client "ready" once-sender localizes to the registered user's SAVED
 *     profile locale (falling back to the guest booking locale), and still
 *     sends exactly once (linkSentAt guard preserved).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Spy on the dispatcher so we can assert the resolved language without a real
// email transport. Only the ready-email export is used by the once-sender.
const readySpy = vi.fn();
vi.mock('@/server/notifications/mock', () => ({
  sendConsultationReadyEmail: (...args: unknown[]) => readySpy(...args),
}));

import { consultationReadyEmailHtml, consultantNewBookingEmailHtml } from '@/server/notifications/email';
import { sendConsultationReadyOnce } from '@/server/notifications/consultation-ready';
import { db } from '@/server/db/store';

const HEADINGS_CLIENT = {
  en: 'Your consultation is ready',
  fr: 'Votre consultation est prête',
  ar: 'استشارتك جاهزة',
} as const;

describe('consultationReadyEmailHtml — client, localized', () => {
  const base = {
    clientName: 'Amine',
    mentorName: 'Sara Consultant',
    meetingMode: 'ONLINE' as const,
    meetingLink: 'https://meet.example/room',
    scheduledAt: null,
    consultationDate: '2026-07-15',
    consultationTime: '14:00',
    durationMinutes: 90,
  };

  for (const lang of ['en', 'fr', 'ar'] as const) {
    it(`renders ${lang}: heading, exact date/time/duration, online link, correct dir`, () => {
      const html = consultationReadyEmailHtml({ ...base, lang });
      expect(html).toContain(HEADINGS_CLIENT[lang]);
      expect(html).toContain(`dir="${lang === 'ar' ? 'rtl' : 'ltr'}"`);
      expect(html).toContain('14:00');        // exact start time
      expect(html).toContain('2026');         // formatted confirmed date
      expect(html).toContain('90');           // duration
      expect(html).toContain('https://meet.example/room'); // meeting link
    });
  }

  it('shows an in-person notice for OFFLINE (no join link)', () => {
    const html = consultationReadyEmailHtml({
      ...base, lang: 'en', meetingMode: 'OFFLINE', meetingLink: null,
      meetingAddress: '12 Rue Didouche, Alger', meetingMapsLink: 'https://maps.google.com/x',
    });
    expect(html).toContain('in person');
    expect(html).toContain('12 Rue Didouche, Alger');
    expect(html).not.toContain('Join the meeting');
  });
});

describe('consultantNewBookingEmailHtml — mentor, localized', () => {
  for (const lang of ['en', 'fr', 'ar'] as const) {
    it(`renders ${lang} with dir + exact date/time/duration + type`, () => {
      const html = consultantNewBookingEmailHtml({
        consultantName: 'Sara',
        scheduledAt: null,
        consultationDate: '2026-07-15',
        consultationTime: '14:00',
        durationMinutes: 60,
        meetingMode: 'OFFLINE',
        portalUrl: 'https://metwork.dz/mentordashboard',
        lang,
      });
      expect(html).toContain(`dir="${lang === 'ar' ? 'rtl' : 'ltr'}"`);
      expect(html).toContain('14:00');
      expect(html).toContain('2026');
      expect(html).toContain('60');
    });
  }
});

describe('sendConsultationReadyOnce — locale resolution + once guard', () => {
  const MENTOR = {
    id: 'm-loc', fullName: 'Sara', position: 'Advisor', imageUrl: '',
    bio: null, linkedinUrl: null, email: 'm@x.io', consultationFee: 8000,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  function readyBooking(over: Record<string, unknown>) {
    return {
      id: 'b-loc', mentorId: 'm-loc', userId: null, userName: 'C', userEmail: 'c@x.io',
      userPhone: '', message: '', status: 'READY', adminNote: null, instantBook: true,
      paymentStatus: 'PAID', durationMinutes: 60, meetingMode: 'ONLINE',
      meetingLink: 'https://meet/x', consultationDate: '2026-07-15', consultationTime: '14:00',
      guestLocale: 'fr', createdAt: '', updatedAt: '', ...over,
    };
  }

  beforeEach(() => { readySpy.mockClear(); });

  it("uses the registered user's SAVED locale (ar) over the booking's guestLocale (fr)", async () => {
    await db.update((d) => {
      d.mentors = [{ ...MENTOR } as never];
      d.users = [{ id: 'u-ar', locale: 'ar' } as never];
      d.mentorBookings = [readyBooking({ userId: 'u-ar', guestLocale: 'fr' }) as never];
    });
    await sendConsultationReadyOnce('b-loc');
    expect(readySpy).toHaveBeenCalledOnce();
    expect(readySpy.mock.calls[0][0].lang).toBe('ar');
  });

  it('falls back to the booking locale for a guest (ar)', async () => {
    await db.update((d) => {
      d.mentors = [{ ...MENTOR } as never];
      d.users = [];
      d.mentorBookings = [readyBooking({ userId: null, guestLocale: 'ar' }) as never];
    });
    await sendConsultationReadyOnce('b-loc');
    expect(readySpy.mock.calls[0][0].lang).toBe('ar');
  });

  it('sends exactly once (linkSentAt guard preserved)', async () => {
    await db.update((d) => {
      d.mentors = [{ ...MENTOR } as never];
      d.users = [];
      d.mentorBookings = [readyBooking({ userId: null, guestLocale: 'en' }) as never];
    });
    await sendConsultationReadyOnce('b-loc');
    await sendConsultationReadyOnce('b-loc');
    expect(readySpy).toHaveBeenCalledOnce();
    expect((await db.read()).mentorBookings.find((b) => b.id === 'b-loc')?.linkSentAt).toBeTruthy();
  });
});
