/**
 * The registration confirmation email speaks the visitor's language.
 *
 * Someone registering in Arabic filled an Arabic form on an RTL page and then
 * received an English receipt: the subject, the "Registration confirmed"
 * banner, and every table heading were hardcoded literals, and
 * `createRegistration` was never given a locale to work with. It now follows
 * the EmailLang / RTL pattern the consultation senders use, driven by the
 * locale captured on the registration row.
 *
 * Also pinned: what a PAID registrant is told to bring on the day. The card
 * receipt covers the accounting; this email carries the operational number,
 * and getting it wrong is the fastest way to an argument at the door.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as EmailModule from '@/server/notifications/email';

// Capture what would have been sent instead of standing up a transport.
const sent: Array<{ to: string; subject: string; html: string }> = [];
vi.mock('@/server/notifications/email', async (importOriginal) => {
  const actual = await importOriginal<typeof EmailModule>();
  return {
    ...actual,
    sendResendEmail: async (opts: { to: string; subject: string; html: string }) => {
      sent.push(opts);
      return true;
    },
  };
});

import { db } from '@/server/db/store';
import { createRegistration, dispatchRegistrationConfirmationIfDue } from '@/server/registrations/service';

const INC = 'inc-reg-email';
const PROG = 'prog-reg-email';

const SUBJECT = {
  en: 'Registration confirmed',
  fr: 'Inscription confirmée',
  ar: 'تم تأكيد التسجيل',
} as const;

const PAID_ONLINE = {
  en: 'Paid online',
  fr: 'Payé en ligne',
  ar: 'المدفوع عبر الإنترنت',
} as const;

const DUE_ON_SITE = {
  en: 'To pay on site',
  fr: 'À payer sur place',
  ar: 'المطلوب في المكان',
} as const;

async function seed(): Promise<void> {
  await db.update((d) => {
    d.incubators = [
      { id: INC, name: 'Test Incubator', status: 'ACTIVE', managerId: 'mgr', email: 'host@x.dz' } as never,
    ];
    d.users = [];
    d.clients = [];
    d.registrations = [];
    d.bookings = [];
    d.events = [];
    d.registrationFormFields = [];
    d.programs = [
      {
        id: PROG, incubatorId: INC, incubatorName: 'Test Incubator', mentorId: null,
        title: 'Formation Entrepreneuriat', description: 'x', type: 'TRAINING', city: 'Alger',
        imageUrl: null, imageUrls: [], price: 0, onlinePrice: null, cashPrice: null,
        seatsTotal: 20, seatsTaken: 0,
        deadline: '2030-01-01T00:00:00.000Z',
        startDate: '2030-02-01T00:00:00.000Z',
        endDate: '2030-03-01T00:00:00.000Z',
        acceptedPaymentMethods: ['ONLINE'], isActive: true, slug: 'f',
        createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
      } as never,
    ];
  });
}

beforeEach(async () => {
  sent.length = 0;
  await seed();
});

/** Emails are dispatched fire-and-forget; let the microtask queue drain. */
async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 20));
}

describe('a FREE registration confirmation', () => {
  for (const lang of ['en', 'fr', 'ar'] as const) {
    it(`is written in ${lang} when the visitor registered in ${lang}`, async () => {
      await createRegistration({
        entityType: 'PROGRAM', entityId: PROG, userId: null,
        fullName: 'Amina B.', email: `amina.${lang}@example.dz`, phone: '+213700112233',
        answers: [], locale: lang,
      });
      await flush();

      expect(sent).toHaveLength(1);
      const mail = sent[0]!;
      expect(mail.to).toBe(`amina.${lang}@example.dz`);
      expect(mail.subject).toContain(SUBJECT[lang]);
      expect(mail.subject).toContain('Formation Entrepreneuriat');
      expect(mail.html).toContain(SUBJECT[lang]);
      // Arabic must render right-to-left, like every other localized sender.
      expect(mail.html).toContain(lang === 'ar' ? 'dir="rtl"' : 'dir="ltr"');
      // A free registration says nothing about money.
      expect(mail.html).not.toContain(PAID_ONLINE[lang]);
    });
  }

  it('falls back to French when the row carries no locale', async () => {
    await createRegistration({
      entityType: 'PROGRAM', entityId: PROG, userId: null,
      fullName: 'Sans Locale', email: 'sans@example.dz', phone: '+213700112233', answers: [],
    });
    await flush();
    expect(sent[0]!.subject).toContain(SUBJECT.fr);
  });

  it('does not re-send when the same email registers again', async () => {
    const input = {
      entityType: 'PROGRAM' as const, entityId: PROG, userId: null,
      fullName: 'Dup', email: 'dup@example.dz', phone: '+213700112233', answers: [], locale: 'fr',
    };
    await createRegistration(input);
    await createRegistration(input);
    await flush();
    expect(sent).toHaveLength(1);
  });
});

describe('a PAID registration confirmation', () => {
  async function paidRegistration(lang: 'en' | 'fr' | 'ar', cashRemaining: number) {
    await db.update((d) => {
      d.bookings.push({
        id: `bk-${lang}`, userId: null, source: 'online', paymentMethod: 'card',
        itemKind: 'PROGRAM', itemId: PROG, itemName: 'Formation Entrepreneuriat',
        vendorName: 'Test Incubator', city: 'Alger', unit: 'DAY', quantity: 1,
        startsAt: '2030-02-01T00:00:00.000Z', endsAt: '2030-03-01T00:00:00.000Z',
        totalAmount: 24_000, status: 'CONFIRMED', clientReference: `ref-${lang}`,
        clientName: 'Karim', clientEmail: `karim.${lang}@example.dz`, clientPhone: '+213700112233',
        paymentMode: cashRemaining > 0 ? 'CASH_DEPOSIT' : 'ONLINE_FULL',
        onlinePaidAmount: 24_000 - cashRemaining,
        onlineChargeAmount: 24_000 - cashRemaining,
        cashRemainingAmount: cashRemaining,
        settledAt: '2026-09-09T00:00:00.000Z',
        createdAt: '2026-09-09T00:00:00.000Z', updatedAt: '2026-09-09T00:00:00.000Z',
      } as never);
      d.registrations.push({
        id: `reg-${lang}`, entityType: 'PROGRAM', entityId: PROG, incubatorId: INC, mentorId: null,
        userId: null, fullName: 'Karim', email: `karim.${lang}@example.dz`, phone: '+213700112233',
        answers: [], status: 'CONFIRMED', clientId: null, bookingId: `bk-${lang}`, locale: lang,
        createdAt: '2026-09-09T00:00:00.000Z', updatedAt: '2026-09-09T00:00:00.000Z',
      } as never);
    });
    await dispatchRegistrationConfirmationIfDue(`bk-${lang}`);
    await flush();
  }

  for (const lang of ['en', 'fr', 'ar'] as const) {
    it(`states the balance due on site, in ${lang}`, async () => {
      await paidRegistration(lang, 18_000);
      expect(sent).toHaveLength(1);
      const html = sent[0]!.html;
      expect(html).toContain(PAID_ONLINE[lang]);
      expect(html).toContain(DUE_ON_SITE[lang]);
      // 6 000 online / 18 000 on site. Strip whatever the locale groups
      // with — en-GB uses a comma, fr-DZ a narrow no-break space.
      const digits = html.replace(/[\s,\u202f\u00a0]/g, '');
      expect(digits).toContain('18000DZD');
      expect(digits).toContain('6000DZD');
    });
  }

  it('says nothing is owed when the whole amount was paid by card', async () => {
    await paidRegistration('fr', 0);
    const html = sent[0]!.html;
    expect(html).toContain(PAID_ONLINE.fr);
    expect(html).not.toContain(DUE_ON_SITE.fr);
    expect(html).toContain('Payé intégralement');
  });

  it('sends exactly once even when settlement replays', async () => {
    await paidRegistration('fr', 18_000);
    await dispatchRegistrationConfirmationIfDue('bk-fr');
    await flush();
    expect(sent).toHaveLength(1);
  });

  it('does nothing for a booking with no registration attached', async () => {
    await dispatchRegistrationConfirmationIfDue('bk-does-not-exist');
    await flush();
    expect(sent).toHaveLength(0);
  });
});
