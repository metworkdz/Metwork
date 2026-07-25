/**
 * Resend email transport.
 *
 * Lazily initialises the Resend client. When RESEND_API_KEY is absent
 * the caller receives null and must fall back to console logging.
 */
import { Resend } from 'resend';

let _resend: Resend | null = null;

function getResend(): Resend | null {
  if (_resend) return _resend;
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  _resend = new Resend(key);
  return _resend;
}

const from = (): string => process.env.EMAIL_FROM ?? 'noreply@metwork.dz';

interface SendOptions {
  to: string;
  subject: string;
  html: string;
  /** Optional file attachments — e.g. PDF receipts. */
  attachments?: Array<{ filename: string; content: Buffer }>;
}

/**
 * Send an email via Resend. Returns false when Resend is not configured (no
 * API key) OR when Resend REJECTS the send, so the caller can fall back to
 * console.log and the failure is visible.
 *
 * The Resend SDK resolves with `{ data, error }` and does NOT throw on API
 * errors (quota/rate limit, restricted key, unverified domain, invalid
 * recipient). Treating that as success silently drops OTP emails — so the
 * `error` field is inspected explicitly here.
 */
export async function sendResendEmail(opts: SendOptions): Promise<boolean> {
  const r = getResend();
  if (!r) return false;
  try {
    const { error } = await r.emails.send({
      from:        from(),
      to:          opts.to,
      subject:     opts.subject,
      html:        opts.html,
      attachments: opts.attachments?.map((a) => ({
        filename: a.filename,
        content:  a.content.toString('base64'),
      })),
    });
    if (error) {
      // eslint-disable-next-line no-console
      console.error(`[notify] Resend rejected email to ${opts.to} → ${error.name}: ${error.message}`);
      return false;
    }
    return true;
  } catch (err) {
    // Network/unexpected throw — surface it and let the caller fall back.
    // eslint-disable-next-line no-console
    console.error(`[notify] Resend threw sending to ${opts.to} →`, err instanceof Error ? err.message : err);
    return false;
  }
}

/* ─────────────────────────── HTML templates ─────────────────────────── */

export function layout(content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Metwork</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Inter,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e4e4e7;">
        <!-- Header -->
        <tr>
          <td style="background:#30a735;padding:24px 40px;">
            <a href="${process.env.NEXT_PUBLIC_APP_URL ?? 'https://metwork.dz'}" style="text-decoration:none;">
              <img src="${process.env.NEXT_PUBLIC_APP_URL ?? 'https://metwork.dz'}/assets/Metworkwhitelogo.png"
                   alt="Metwork" width="160" height="44"
                   style="display:block;height:44px;width:auto;"
                   onerror="this.style.display='none';this.nextElementSibling.style.display='inline';" />
              <span style="display:none;color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.5px;">Metwork</span>
            </a>
          </td>
        </tr>
        <!-- Body -->
        <tr><td style="padding:40px;">${content}</td></tr>
        <!-- Footer -->
        <tr>
          <td style="padding:24px 40px;background:#f9fafb;border-top:1px solid #e4e4e7;">
            <p style="margin:0;font-size:12px;color:#71717a;line-height:1.6;">
              You received this email from Metwork &mdash; Algeria&apos;s startup ecosystem platform.<br />
              &copy; ${new Date().getFullYear()} Metwork. All rights reserved.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function button(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;margin-top:8px;padding:14px 32px;background:#30a735;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">${label}</a>`;
}

function p(text: string): string {
  return `<p style="margin:0 0 16px;font-size:15px;color:#3f3f46;line-height:1.6;">${text}</p>`;
}

function h1(text: string): string {
  return `<h1 style="margin:0 0 20px;font-size:22px;font-weight:700;color:#09090b;letter-spacing:-0.3px;">${text}</h1>`;
}

export function welcomeEmailHtml(opts: { fullName: string; role: string; dashboardUrl: string }): string {
  const roleLabel =
    opts.role === 'ENTREPRENEUR' ? 'entrepreneur'
    : opts.role === 'INVESTOR'   ? 'investor'
    : opts.role === 'INCUBATOR'  ? 'incubator manager'
    : 'member';

  return layout(`
    ${h1(`Welcome to Metwork, ${opts.fullName}! 🎉`)}
    ${p(`Your account is verified and ready. You've joined as an <strong>${roleLabel}</strong> on Algeria's startup ecosystem platform.`)}
    ${p('Here&rsquo;s what you can do right now:')}
    <ul style="margin:0 0 20px;padding:0 0 0 20px;color:#3f3f46;font-size:15px;line-height:2;">
      <li>Browse coworking spaces and apply to programs</li>
      <li>Connect with mentors and investors</li>
      <li>Explore the startup marketplace</li>
    </ul>
    ${button(opts.dashboardUrl, 'Go to your dashboard')}
    ${p('<span style="color:#71717a;font-size:13px;">If you have any questions, reply to this email or visit our help centre.</span>')}
  `);
}

/* ─────────────── Incubator approval (admin gate) ─────────────── */

/** Supported email locales. Arabic is RTL — templates set dir accordingly. */
export type EmailLang = 'en' | 'fr' | 'ar';

/** Normalize any incoming locale to a supported email locale (default fr). */
export function normalizeEmailLang(lang?: string | null): EmailLang {
  return lang === 'en' ? 'en' : lang === 'ar' ? 'ar' : 'fr';
}

/** Intl locale used to render dates/times per email locale. */
const EMAIL_LOCALE: Record<EmailLang, string> = { en: 'en-GB', fr: 'fr-DZ', ar: 'ar-DZ' };

/**
 * Resolve the EXACT confirmed date + start time for display, preferring the
 * authoritative `consultationDate`/`consultationTime` fields (set at booking
 * time) and falling back to `scheduledAt` for legacy bookings. The date is
 * formatted long-form in the email locale; the start time is the mentor-local
 * "HH:MM" as stored (no timezone reinterpretation). Anchoring the explicit date
 * at UTC-noon keeps the day stable regardless of the server timezone.
 */
export function formatEmailSlot(
  lang: EmailLang,
  input: { scheduledAt?: string | null; consultationDate?: string | null; consultationTime?: string | null },
): { date: string | null; time: string | null } {
  const loc = EMAIL_LOCALE[lang];
  if (input.consultationDate) {
    let date = input.consultationDate;
    const anchored = new Date(`${input.consultationDate}T12:00:00Z`);
    if (!Number.isNaN(anchored.getTime())) {
      date = anchored.toLocaleDateString(loc, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
    }
    return { date, time: input.consultationTime || null };
  }
  if (input.scheduledAt) {
    const d = new Date(input.scheduledAt);
    if (!Number.isNaN(d.getTime())) {
      return {
        date: d.toLocaleDateString(loc, { year: 'numeric', month: 'long', day: 'numeric' }),
        time: d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit', hour12: false }),
      };
    }
  }
  return { date: null, time: null };
}

interface IncubatorApprovalCopy {
  subject: string;
  heading: string;
  intro: string;
  next: string;
  bullets: string[];
  cta: string;
  footer: string;
}

/** Localized strings for the incubator-approval email (en / fr / ar). */
const INCUBATOR_APPROVAL_COPY: Record<EmailLang, (incubatorName: string) => IncubatorApprovalCopy> = {
  en: (name) => ({
    subject: 'Your incubator is approved on Metwork',
    heading: `${name} is approved! 🎉`,
    intro:
      'Great news — your incubator profile has just been approved by the Metwork team. ' +
      'Your coworking spaces, programs and events are now visible to the public on the platform.',
    next: 'Here\'s what you can do next:',
    bullets: [
      'Publish spaces and start accepting bookings',
      'Create programs and events for your community',
      'Invite your team and manage payouts',
    ],
    cta: 'Open your dashboard',
    footer: 'Need help getting started? Reply to this email and our team will guide you.',
  }),
  fr: (name) => ({
    subject: 'Votre compte Metwork a été approuvé',
    heading: `${name} est approuvé ! 🎉`,
    intro:
      'Votre compte Metwork a été approuvé. Vous pouvez maintenant profiter de toutes les ' +
      'fonctionnalités. Vos espaces de coworking, programmes et événements sont désormais visibles ' +
      'publiquement sur la plateforme.',
    next: 'Voici ce que vous pouvez faire maintenant :',
    bullets: [
      'Publier vos espaces et activer les réservations',
      'Créer programmes et événements pour votre communauté',
      'Inviter votre équipe et gérer les paiements',
    ],
    cta: 'Accéder à mon tableau de bord',
    footer: 'Besoin d\'aide pour démarrer ? Répondez à cet e-mail et notre équipe vous accompagnera.',
  }),
  ar: (name) => ({
    subject: 'تمت الموافقة على حسابك في Metwork',
    heading: `تمت الموافقة على ${name}! 🎉`,
    intro:
      'تمت الموافقة على حسابك في Metwork. يمكنك الآن الاستفادة من جميع الميزات. أصبحت مساحات العمل ' +
      'المشترك والبرامج والفعاليات الخاصة بك مرئية الآن للجميع على المنصة.',
    next: 'إليك ما يمكنك فعله الآن:',
    bullets: [
      'نشر مساحاتك وبدء قبول الحجوزات',
      'إنشاء البرامج والفعاليات لمجتمعك',
      'دعوة فريقك وإدارة المدفوعات',
    ],
    cta: 'الذهاب إلى لوحة التحكم',
    footer: 'هل تحتاج مساعدة للبدء؟ رد على هذا البريد وسيرشدك فريقنا.',
  }),
};

export function incubatorApprovalEmailHtml(opts: {
  incubatorName: string;
  dashboardUrl: string;
  lang?: EmailLang;
}): string {
  const lang = normalizeEmailLang(opts.lang);
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const c = INCUBATOR_APPROVAL_COPY[lang](opts.incubatorName);

  return layout(`
    <div dir="${dir}">
    ${h1(c.heading)}
    ${p(c.intro)}
    ${p(c.next)}
    <ul style="margin:0 0 20px;padding:0 20px;color:#3f3f46;font-size:15px;line-height:2;">
      ${c.bullets.map((b) => `<li>${b}</li>`).join('')}
    </ul>
    ${button(opts.dashboardUrl, c.cta)}
    ${p(`<span style="color:#71717a;font-size:13px;">${c.footer}</span>`)}
    </div>
  `);
}

/**
 * Send the "your incubator is approved" email when an admin transitions an
 * incubator from PENDING → ACTIVE. Falls back to console logging when no
 * Resend API key is configured (same convention as every other sender here).
 */
export async function sendIncubatorApprovalEmail(opts: {
  to: string;
  incubatorName: string;
  lang?: EmailLang;
}): Promise<boolean> {
  const lang = normalizeEmailLang(opts.lang);
  const subject = INCUBATOR_APPROVAL_COPY[lang](opts.incubatorName).subject;
  const dashboardUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://metwork.dz'}/dashboard`;
  const html = incubatorApprovalEmailHtml({
    incubatorName: opts.incubatorName,
    dashboardUrl,
    lang,
  });
  const delivered = await sendResendEmail({ to: opts.to, subject, html });
  if (!delivered) {
    // Resend not configured — log for ops visibility.
    console.log('[email/incubator-approval]', { to: opts.to, subject });
  }
  return delivered;
}

/* ─────────────── Incubator rejection (admin gate) ─────────────── */

interface RejectionCopy {
  subject: string;
  heading: string;
  intro: string;
  reasonLabel: string;
  next: string;
  footer: string;
}

const INCUBATOR_REJECTION_COPY: Record<EmailLang, (name: string) => RejectionCopy> = {
  en: (name) => ({
    subject: 'Your Metwork incubator account — more information needed',
    heading: `Update on ${name}`,
    intro:
      'Thank you for registering on Metwork. After review, your incubator account has not been ' +
      'approved yet.',
    reasonLabel: 'Reason',
    next:
      'You can update your profile with the requested information and reply to this email — we will ' +
      'review your account again.',
    footer: 'Questions? Just reply to this email and our team will help.',
  }),
  fr: (name) => ({
    subject: 'Votre compte incubateur Metwork — informations complémentaires requises',
    heading: `Mise à jour concernant ${name}`,
    intro:
      'Merci de votre inscription sur Metwork. Après examen, votre compte incubateur n\'a pas encore ' +
      'été approuvé.',
    reasonLabel: 'Motif',
    next:
      'Vous pouvez mettre à jour votre profil avec les informations demandées et répondre à cet ' +
      'e-mail — nous réexaminerons votre compte.',
    footer: 'Des questions ? Répondez simplement à cet e-mail et notre équipe vous aidera.',
  }),
  ar: (name) => ({
    subject: 'حساب الحاضنة في Metwork — مطلوب معلومات إضافية',
    heading: `تحديث بخصوص ${name}`,
    intro:
      'شكرًا لتسجيلك في Metwork. بعد المراجعة، لم تتم الموافقة على حساب الحاضنة الخاص بك بعد.',
    reasonLabel: 'السبب',
    next:
      'يمكنك تحديث ملفك بالمعلومات المطلوبة والرد على هذا البريد — وسنراجع حسابك مرة أخرى.',
    footer: 'هل لديك أسئلة؟ رد على هذا البريد وسيساعدك فريقنا.',
  }),
};

const INVESTOR_REJECTION_COPY: Record<EmailLang, (name: string) => RejectionCopy> = {
  en: (name) => ({
    subject: 'Your Metwork investor account — more information needed',
    heading: `Update on your account, ${name}`,
    intro:
      'Thank you for registering on Metwork. After review, your investor account has not been ' +
      'approved yet.',
    reasonLabel: 'Reason',
    next:
      'You can provide more information by replying to this email — we will review your account again.',
    footer: 'Questions? Just reply to this email and our team will help.',
  }),
  fr: (name) => ({
    subject: 'Votre compte investisseur Metwork — informations complémentaires requises',
    heading: `Mise à jour concernant votre compte, ${name}`,
    intro:
      'Merci de votre inscription sur Metwork. Après examen, votre compte investisseur n\'a pas ' +
      'encore été approuvé.',
    reasonLabel: 'Motif',
    next:
      'Vous pouvez fournir plus d\'informations en répondant à cet e-mail — nous réexaminerons votre compte.',
    footer: 'Des questions ? Répondez simplement à cet e-mail et notre équipe vous aidera.',
  }),
  ar: (name) => ({
    subject: 'حساب المستثمر في Metwork — مطلوب معلومات إضافية',
    heading: `تحديث بخصوص حسابك، ${name}`,
    intro:
      'شكرًا لتسجيلك في Metwork. بعد المراجعة، لم تتم الموافقة على حساب المستثمر الخاص بك بعد.',
    reasonLabel: 'السبب',
    next:
      'يمكنك تقديم مزيد من المعلومات بالرد على هذا البريد — وسنراجع حسابك مرة أخرى.',
    footer: 'هل لديك أسئلة؟ رد على هذا البريد وسيساعدك فريقنا.',
  }),
};

function rejectionEmailHtml(c: RejectionCopy, reason: string, lang: EmailLang): string {
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const safeReason = reason.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return layout(`
    <div dir="${dir}">
    ${h1(c.heading)}
    ${p(c.intro)}
    ${reason.trim() ? `
    <div style="background:#f9fafb;border:1px solid #e4e4e7;border-radius:8px;padding:16px 20px;margin:20px 0;">
      <p style="margin:0 0 4px;font-size:13px;color:#71717a;font-weight:600;">${c.reasonLabel}</p>
      <p style="margin:0;font-size:14px;color:#3f3f46;white-space:pre-line;">${safeReason}</p>
    </div>` : ''}
    ${p(c.next)}
    ${p(`<span style="color:#71717a;font-size:13px;">${c.footer}</span>`)}
    </div>
  `);
}

/** Send the incubator-rejection email (incubator locale, default fr). */
export async function sendIncubatorRejectionEmail(opts: {
  to: string;
  incubatorName: string;
  reason: string;
  lang?: EmailLang;
}): Promise<boolean> {
  const lang = normalizeEmailLang(opts.lang);
  const c = INCUBATOR_REJECTION_COPY[lang](opts.incubatorName);
  const html = rejectionEmailHtml(c, opts.reason, lang);
  const delivered = await sendResendEmail({ to: opts.to, subject: c.subject, html });
  if (!delivered) console.log('[email/incubator-rejection]', { to: opts.to, subject: c.subject });
  return delivered;
}

/* ─────────────── Investor approval / rejection (admin gate) ─────────────── */

const INVESTOR_APPROVAL_COPY: Record<EmailLang, (name: string) => IncubatorApprovalCopy> = {
  en: (name) => ({
    subject: 'Your Metwork investor account is approved',
    heading: `Welcome aboard, ${name}! 🎉`,
    intro:
      'Your Metwork investor account has been approved. You now have full access to the startup ' +
      'directory and your investor dashboard.',
    next: 'Here\'s what you can do next:',
    bullets: [
      'Browse the startup directory',
      'Save and track promising ventures',
      'Request introductions and manage your portfolio',
    ],
    cta: 'Open your dashboard',
    footer: 'Need help getting started? Reply to this email and our team will guide you.',
  }),
  fr: (name) => ({
    subject: 'Votre compte investisseur Metwork a été approuvé',
    heading: `Bienvenue, ${name} ! 🎉`,
    intro:
      'Votre compte Metwork a été approuvé. Vous pouvez maintenant profiter de toutes les ' +
      'fonctionnalités : l\'annuaire des startups et votre tableau de bord investisseur.',
    next: 'Voici ce que vous pouvez faire maintenant :',
    bullets: [
      'Parcourir l\'annuaire des startups',
      'Enregistrer et suivre les projets prometteurs',
      'Demander des mises en relation et gérer votre portefeuille',
    ],
    cta: 'Accéder à mon tableau de bord',
    footer: 'Besoin d\'aide pour démarrer ? Répondez à cet e-mail et notre équipe vous accompagnera.',
  }),
  ar: (name) => ({
    subject: 'تمت الموافقة على حساب المستثمر الخاص بك في Metwork',
    heading: `مرحبًا بك، ${name}! 🎉`,
    intro:
      'تمت الموافقة على حسابك في Metwork. يمكنك الآن الاستفادة من جميع الميزات: دليل الشركات الناشئة ' +
      'ولوحة تحكم المستثمر.',
    next: 'إليك ما يمكنك فعله الآن:',
    bullets: [
      'تصفح دليل الشركات الناشئة',
      'حفظ ومتابعة المشاريع الواعدة',
      'طلب التعارف وإدارة محفظتك',
    ],
    cta: 'الذهاب إلى لوحة التحكم',
    footer: 'هل تحتاج مساعدة للبدء؟ رد على هذا البريد وسيرشدك فريقنا.',
  }),
};

/** Send the investor-approval email (investor locale, default fr). */
export async function sendInvestorApprovalEmail(opts: {
  to: string;
  investorName: string;
  lang?: EmailLang;
}): Promise<boolean> {
  const lang = normalizeEmailLang(opts.lang);
  const c = INVESTOR_APPROVAL_COPY[lang](opts.investorName);
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const dashboardUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://metwork.dz'}/dashboard`;
  const html = layout(`
    <div dir="${dir}">
    ${h1(c.heading)}
    ${p(c.intro)}
    ${p(c.next)}
    <ul style="margin:0 0 20px;padding:0 20px;color:#3f3f46;font-size:15px;line-height:2;">
      ${c.bullets.map((b) => `<li>${b}</li>`).join('')}
    </ul>
    ${button(dashboardUrl, c.cta)}
    ${p(`<span style="color:#71717a;font-size:13px;">${c.footer}</span>`)}
    </div>
  `);
  const delivered = await sendResendEmail({ to: opts.to, subject: c.subject, html });
  if (!delivered) console.log('[email/investor-approval]', { to: opts.to, subject: c.subject });
  return delivered;
}

/** Send the investor-rejection email (investor locale, default fr). */
export async function sendInvestorRejectionEmail(opts: {
  to: string;
  investorName: string;
  reason: string;
  lang?: EmailLang;
}): Promise<boolean> {
  const lang = normalizeEmailLang(opts.lang);
  const c = INVESTOR_REJECTION_COPY[lang](opts.investorName);
  const html = rejectionEmailHtml(c, opts.reason, lang);
  const delivered = await sendResendEmail({ to: opts.to, subject: c.subject, html });
  if (!delivered) console.log('[email/investor-rejection]', { to: opts.to, subject: c.subject });
  return delivered;
}

/* ─────────────── Consultant (mentor) approval / rejection ─────────────── */

const CONSULTANT_APPROVAL_COPY: Record<EmailLang, (name: string) => IncubatorApprovalCopy> = {
  en: (name) => ({
    subject: 'Your Metwork consultant profile is approved',
    heading: `Welcome aboard, ${name}! 🎉`,
    intro:
      'Your consultant profile has been approved. You are now visible on the Metwork mentors page ' +
      'and clients can book consultations with you.',
    next: 'Here\'s what to do next:',
    bullets: [
      'Complete your bio, expertise and photo from the portal',
      'Set your weekly availability so clients can pick a slot',
      'Add your payout account to withdraw your earnings',
    ],
    cta: 'Open the consultant portal',
    footer: 'Need help getting started? Reply to this email and our team will guide you.',
  }),
  fr: (name) => ({
    subject: 'Votre profil consultant Metwork a été approuvé',
    heading: `Bienvenue, ${name} ! 🎉`,
    intro:
      'Votre profil consultant a été approuvé. Vous êtes désormais visible sur la page mentors de ' +
      'Metwork et les clients peuvent réserver des consultations avec vous.',
    next: 'Voici les prochaines étapes :',
    bullets: [
      'Complétez votre bio, vos expertises et votre photo depuis le portail',
      'Définissez vos disponibilités hebdomadaires pour permettre la réservation',
      'Ajoutez votre compte de paiement pour retirer vos gains',
    ],
    cta: 'Accéder au portail consultant',
    footer: 'Besoin d\'aide pour démarrer ? Répondez à cet e-mail et notre équipe vous accompagnera.',
  }),
  ar: (name) => ({
    subject: 'تمت الموافقة على ملفك كمستشار في Metwork',
    heading: `مرحبًا بك، ${name}! 🎉`,
    intro:
      'تمت الموافقة على ملفك كمستشار. أصبحت الآن ظاهرًا في صفحة المرشدين على Metwork ويمكن للعملاء ' +
      'حجز استشارات معك.',
    next: 'إليك الخطوات التالية:',
    bullets: [
      'أكمل نبذتك ومجالات خبرتك وصورتك من البوابة',
      'حدّد أوقات توفرك الأسبوعية ليتمكن العملاء من الحجز',
      'أضف حساب الدفع الخاص بك لسحب أرباحك',
    ],
    cta: 'فتح بوابة المستشار',
    footer: 'هل تحتاج مساعدة للبدء؟ رد على هذا البريد وسيرشدك فريقنا.',
  }),
};

const CONSULTANT_REJECTION_COPY: Record<EmailLang, (name: string) => RejectionCopy> = {
  en: (name) => ({
    subject: 'Your Metwork consultant application — more information needed',
    heading: `Update on your application, ${name}`,
    intro:
      'Thank you for applying to become a consultant on Metwork. After review, your profile has ' +
      'not been approved yet.',
    reasonLabel: 'Reason',
    next:
      'You can provide more information by replying to this email — we will review your application again.',
    footer: 'Questions? Just reply to this email and our team will help.',
  }),
  fr: (name) => ({
    subject: 'Votre candidature consultant Metwork — informations complémentaires requises',
    heading: `Mise à jour concernant votre candidature, ${name}`,
    intro:
      'Merci d\'avoir postulé pour devenir consultant sur Metwork. Après examen, votre profil n\'a ' +
      'pas encore été approuvé.',
    reasonLabel: 'Motif',
    next:
      'Vous pouvez fournir plus d\'informations en répondant à cet e-mail — nous réexaminerons votre candidature.',
    footer: 'Des questions ? Répondez simplement à cet e-mail et notre équipe vous aidera.',
  }),
  ar: (name) => ({
    subject: 'طلبك كمستشار في Metwork — مطلوب معلومات إضافية',
    heading: `تحديث بخصوص طلبك، ${name}`,
    intro:
      'شكرًا لتقدمك لتصبح مستشارًا في Metwork. بعد المراجعة، لم تتم الموافقة على ملفك بعد.',
    reasonLabel: 'السبب',
    next:
      'يمكنك تقديم مزيد من المعلومات بالرد على هذا البريد — وسنراجع طلبك مرة أخرى.',
    footer: 'هل لديك أسئلة؟ رد على هذا البريد وسيساعدك فريقنا.',
  }),
};

/** Send the consultant-approval email (consultant locale, default fr). */
export async function sendConsultantApprovalEmail(opts: {
  to: string;
  consultantName: string;
  lang?: EmailLang;
}): Promise<boolean> {
  const lang = normalizeEmailLang(opts.lang);
  const c = CONSULTANT_APPROVAL_COPY[lang](opts.consultantName);
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const portalUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://metwork.dz'}/mentordashboard`;
  const html = layout(`
    <div dir="${dir}">
    ${h1(c.heading)}
    ${p(c.intro)}
    ${p(c.next)}
    <ul style="margin:0 0 20px;padding:0 20px;color:#3f3f46;font-size:15px;line-height:2;">
      ${c.bullets.map((b) => `<li>${b}</li>`).join('')}
    </ul>
    ${button(portalUrl, c.cta)}
    ${p(`<span style="color:#71717a;font-size:13px;">${c.footer}</span>`)}
    </div>
  `);
  const delivered = await sendResendEmail({ to: opts.to, subject: c.subject, html });
  if (!delivered) console.log('[email/consultant-approval]', { to: opts.to, subject: c.subject });
  return delivered;
}

/** Send the consultant-rejection email (consultant locale, default fr). */
export async function sendConsultantRejectionEmail(opts: {
  to: string;
  consultantName: string;
  reason: string;
  lang?: EmailLang;
}): Promise<boolean> {
  const lang = normalizeEmailLang(opts.lang);
  const c = CONSULTANT_REJECTION_COPY[lang](opts.consultantName);
  const html = rejectionEmailHtml(c, opts.reason, lang);
  const delivered = await sendResendEmail({ to: opts.to, subject: c.subject, html });
  if (!delivered) console.log('[email/consultant-rejection]', { to: opts.to, subject: c.subject });
  return delivered;
}

/* ─────────────── Business approval / rejection (admin gate) ─────────────── */
// Neutral copy for the BUSINESS role (trainer / training centre / company) —
// avoids the incubator-specific "coworking spaces" wording.

const BUSINESS_APPROVAL_COPY: Record<EmailLang, (name: string) => IncubatorApprovalCopy> = {
  en: (name) => ({
    subject: 'Your business account is approved on Metwork',
    heading: `${name} is approved! 🎉`,
    intro:
      'Great news — your business account has just been approved by the Metwork team. ' +
      'Your programs and events are now visible to the public on the platform.',
    next: 'Here\'s what you can do next:',
    bullets: [
      'Publish programs and events',
      'Accept bookings and registrations',
      'Manage your wallet and payouts',
    ],
    cta: 'Open your dashboard',
    footer: 'Need help getting started? Reply to this email and our team will guide you.',
  }),
  fr: (name) => ({
    subject: 'Votre compte professionnel a été approuvé sur Metwork',
    heading: `${name} est approuvé ! 🎉`,
    intro:
      'Votre compte professionnel vient d\'être approuvé par l\'équipe Metwork. Vos programmes et ' +
      'événements sont désormais visibles publiquement sur la plateforme.',
    next: 'Voici ce que vous pouvez faire maintenant :',
    bullets: [
      'Publier vos programmes et événements',
      'Accepter les réservations et inscriptions',
      'Gérer votre portefeuille et vos paiements',
    ],
    cta: 'Accéder à mon tableau de bord',
    footer: 'Besoin d\'aide pour démarrer ? Répondez à cet e-mail et notre équipe vous accompagnera.',
  }),
  ar: (name) => ({
    subject: 'تمت الموافقة على حسابك المهني في Metwork',
    heading: `تمت الموافقة على ${name}! 🎉`,
    intro:
      'تمت الموافقة على حسابك المهني من قبل فريق Metwork. أصبحت برامجك وفعالياتك مرئية الآن للجميع ' +
      'على المنصة.',
    next: 'إليك ما يمكنك فعله الآن:',
    bullets: [
      'نشر برامجك وفعالياتك',
      'قبول الحجوزات والتسجيلات',
      'إدارة محفظتك ومدفوعاتك',
    ],
    cta: 'الذهاب إلى لوحة التحكم',
    footer: 'هل تحتاج مساعدة للبدء؟ رد على هذا البريد وسيرشدك فريقنا.',
  }),
};

const BUSINESS_REJECTION_COPY: Record<EmailLang, (name: string) => RejectionCopy> = {
  en: (name) => ({
    subject: 'Your Metwork business account — more information needed',
    heading: `Update on ${name}`,
    intro:
      'Thank you for registering on Metwork. After review, your business account has not been ' +
      'approved yet.',
    reasonLabel: 'Reason',
    next:
      'You can update your profile with the requested information and reply to this email — we will ' +
      'review your account again.',
    footer: 'Questions? Just reply to this email and our team will help.',
  }),
  fr: (name) => ({
    subject: 'Votre compte professionnel Metwork — informations complémentaires requises',
    heading: `Mise à jour concernant ${name}`,
    intro:
      'Merci de votre inscription sur Metwork. Après examen, votre compte professionnel n\'a pas ' +
      'encore été approuvé.',
    reasonLabel: 'Motif',
    next:
      'Vous pouvez mettre à jour votre profil avec les informations demandées et répondre à cet ' +
      'e-mail — nous réexaminerons votre compte.',
    footer: 'Des questions ? Répondez simplement à cet e-mail et notre équipe vous aidera.',
  }),
  ar: (name) => ({
    subject: 'حسابك المهني في Metwork — مطلوب معلومات إضافية',
    heading: `تحديث بخصوص ${name}`,
    intro:
      'شكرًا لتسجيلك في Metwork. بعد المراجعة، لم تتم الموافقة على حسابك المهني بعد.',
    reasonLabel: 'السبب',
    next:
      'يمكنك تحديث ملفك بالمعلومات المطلوبة والرد على هذا البريد — وسنراجع حسابك مرة أخرى.',
    footer: 'هل لديك أسئلة؟ رد على هذا البريد وسيساعدك فريقنا.',
  }),
};

/** Send the "your business account is approved" email (account locale, default fr). */
export async function sendBusinessApprovalEmail(opts: {
  to: string;
  businessName: string;
  lang?: EmailLang;
}): Promise<boolean> {
  const lang = normalizeEmailLang(opts.lang);
  const c = BUSINESS_APPROVAL_COPY[lang](opts.businessName);
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const dashboardUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://metwork.dz'}/dashboard`;
  const html = layout(`
    <div dir="${dir}">
    ${h1(c.heading)}
    ${p(c.intro)}
    ${p(c.next)}
    <ul style="margin:0 0 20px;padding:0 20px;color:#3f3f46;font-size:15px;line-height:2;">
      ${c.bullets.map((b) => `<li>${b}</li>`).join('')}
    </ul>
    ${button(dashboardUrl, c.cta)}
    ${p(`<span style="color:#71717a;font-size:13px;">${c.footer}</span>`)}
    </div>
  `);
  const delivered = await sendResendEmail({ to: opts.to, subject: c.subject, html });
  if (!delivered) console.log('[email/business-approval]', { to: opts.to, subject: c.subject });
  return delivered;
}

/** Send the business-rejection email (account locale, default fr). */
export async function sendBusinessRejectionEmail(opts: {
  to: string;
  businessName: string;
  reason: string;
  lang?: EmailLang;
}): Promise<boolean> {
  const lang = normalizeEmailLang(opts.lang);
  const c = BUSINESS_REJECTION_COPY[lang](opts.businessName);
  const html = rejectionEmailHtml(c, opts.reason, lang);
  const delivered = await sendResendEmail({ to: opts.to, subject: c.subject, html });
  if (!delivered) console.log('[email/business-rejection]', { to: opts.to, subject: c.subject });
  return delivered;
}

export function otpEmailHtml(code: string): string {
  return layout(`
    ${h1('Your verification code')}
    ${p('Use the code below to complete your Metwork registration. It expires in <strong>10 minutes</strong>.')}
    <div style="text-align:center;margin:32px 0;">
      <span style="display:inline-block;padding:18px 40px;background:#f4f4f5;border-radius:12px;font-size:36px;font-weight:700;letter-spacing:10px;color:#09090b;font-family:monospace;">${code}</span>
    </div>
    ${p('<span style="color:#71717a;font-size:13px;">If you did not request this code, you can safely ignore this email.</span>')}
  `);
}

export function verificationEmailHtml(link: string): string {
  return layout(`
    ${h1('Verify your email address')}
    ${p('Thanks for joining Metwork. Click the button below to confirm your email address and activate your account.')}
    ${button(link, 'Verify email address')}
    ${p(`<span style="color:#71717a;font-size:13px;">Or copy this link into your browser:<br /><span style="word-break:break-all;">${link}</span></span>`)}
    ${p('<span style="color:#71717a;font-size:13px;">This link expires in 24 hours. If you did not create a Metwork account, you can safely ignore this email.</span>')}
  `);
}

export function passwordResetEmailHtml(link: string): string {
  return layout(`
    ${h1('Reset your password')}
    ${p('We received a request to reset the password for your Metwork account. Click the button below to choose a new password.')}
    ${button(link, 'Reset password')}
    ${p(`<span style="color:#71717a;font-size:13px;">Or copy this link into your browser:<br /><span style="word-break:break-all;">${link}</span></span>`)}
    ${p('<span style="color:#71717a;font-size:13px;">This link expires in 1 hour. If you did not request a password reset, you can safely ignore this email &mdash; your password has not changed.</span>')}
  `);
}

/** Sent to the client once their paid consultation has a confirmed meeting format (READY). */
interface ConsultationReadyCopy {
  heading: string;
  intro: (client: string, mentor: string) => string;
  dateLabel: string;
  timeLabel: string;
  durationLabel: string;
  minutes: string;
  inPerson: string;
  joinCta: string;
  orCopy: string;
  addressLabel: string;
  mapsCta: string;
}

/** Localized copy for the client "consultation ready / confirmed" email. */
const CONSULTATION_READY_COPY: Record<EmailLang, ConsultationReadyCopy> = {
  en: {
    heading: 'Your consultation is ready',
    intro: (c, m) => `Hi ${c}, your session with ${m} is confirmed.`,
    dateLabel: 'Date', timeLabel: 'Start time', durationLabel: 'Duration', minutes: 'min',
    inPerson: 'Format: in person', joinCta: 'Join the meeting', orCopy: 'Or copy this link:',
    addressLabel: 'Address', mapsCta: 'Open in Google Maps',
  },
  fr: {
    heading: 'Votre consultation est prête',
    intro: (c, m) => `Bonjour ${c}, votre session avec ${m} est confirmée.`,
    dateLabel: 'Date', timeLabel: 'Heure de début', durationLabel: 'Durée', minutes: 'min',
    inPerson: 'Format : en présentiel', joinCta: 'Rejoindre la réunion', orCopy: 'Ou copiez ce lien :',
    addressLabel: 'Adresse', mapsCta: 'Ouvrir dans Google Maps',
  },
  ar: {
    heading: 'استشارتك جاهزة',
    intro: (c, m) => `مرحبًا ${c}، تم تأكيد جلستك مع ${m}.`,
    dateLabel: 'التاريخ', timeLabel: 'وقت البدء', durationLabel: 'المدة', minutes: 'دقيقة',
    inPerson: 'النوع: حضوري', joinCta: 'الانضمام إلى الاجتماع', orCopy: 'أو انسخ هذا الرابط:',
    addressLabel: 'العنوان', mapsCta: 'فتح في خرائط Google',
  },
};

export function consultationReadyEmailHtml(params: {
  clientName: string;
  mentorName: string;
  meetingMode: 'ONLINE' | 'OFFLINE' | null;
  meetingLink: string | null;
  /** In-person address (OFFLINE). */
  meetingAddress?: string | null;
  /** Google Maps link for the in-person address (OFFLINE). */
  meetingMapsLink?: string | null;
  scheduledAt: string | null;
  /** Exact confirmed fields (preferred over scheduledAt when present). */
  consultationDate?: string | null;
  consultationTime?: string | null;
  durationMinutes: number | null;
  lang: EmailLang;
}): string {
  const lang = normalizeEmailLang(params.lang);
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const c = CONSULTATION_READY_COPY[lang];
  const { date, time } = formatEmailSlot(lang, params);
  const details = [
    date ? `${c.dateLabel} : ${date}` : null,
    time ? `${c.timeLabel} : ${time}` : null,
    params.durationMinutes ? `${c.durationLabel} : ${params.durationMinutes} ${c.minutes}` : null,
    params.meetingMode === 'OFFLINE' ? c.inPerson : null,
  ].filter(Boolean).join('<br />');

  return layout(`
    <div dir="${dir}">
    ${h1(c.heading)}
    ${p(c.intro(params.clientName, params.mentorName))}
    ${details ? p(`<span style="color:#3f3f46;">${details}</span>`) : ''}
    ${params.meetingMode === 'ONLINE' && params.meetingLink
      ? button(params.meetingLink, c.joinCta)
      : ''}
    ${params.meetingMode === 'ONLINE' && params.meetingLink
      ? p(`<span style="color:#71717a;font-size:13px;">${c.orCopy}<br /><span style="word-break:break-all;">${params.meetingLink}</span></span>`)
      : ''}
    ${params.meetingMode === 'OFFLINE' && params.meetingAddress
      ? p(`<span style="color:#3f3f46;">${c.addressLabel} : ${params.meetingAddress}</span>`)
      : ''}
    ${params.meetingMode === 'OFFLINE' && params.meetingMapsLink
      ? button(params.meetingMapsLink, c.mapsCta)
      : ''}
    </div>
  `);
}

/**
 * Sent to the CONSULTANT when a new consultation is booked & confirmed. Carries
 * only a NON-PII summary (date / duration / format) — the client's contact
 * details live behind the PIN-gated consultant portal, linked via the button.
 */
interface ConsultantNewBookingCopy {
  heading: string;
  intro: (consultant: string) => string;
  dateLabel: string;
  timeLabel: string;
  durationLabel: string;
  minutes: string;
  typeLabel: string;
  online: string;
  inPerson: string;
  cta: string;
  piiNote: string;
}

/** Localized copy for the consultant "new booking" notification email. */
const CONSULTANT_NEW_BOOKING_COPY: Record<EmailLang, ConsultantNewBookingCopy> = {
  en: {
    heading: 'New consultation booked',
    intro: (n) => `Hello ${n}, a new consultation has just been booked and confirmed.`,
    dateLabel: 'Date', timeLabel: 'Start time', durationLabel: 'Duration', minutes: 'min',
    typeLabel: 'Type', online: 'Online', inPerson: 'In person', cta: 'View the booking',
    piiNote: 'The client’s contact details are available in your consultant portal, protected by your PIN.',
  },
  fr: {
    heading: 'Nouvelle consultation réservée',
    intro: (n) => `Bonjour ${n}, une nouvelle consultation vient d'être réservée et confirmée.`,
    dateLabel: 'Date', timeLabel: 'Heure de début', durationLabel: 'Durée', minutes: 'min',
    typeLabel: 'Type', online: 'En ligne', inPerson: 'En présentiel', cta: 'Voir la réservation',
    piiNote: 'Les coordonnées du client sont disponibles dans votre espace consultant, protégé par votre code PIN.',
  },
  ar: {
    heading: 'حجز استشارة جديدة',
    intro: (n) => `مرحبًا ${n}، تم حجز وتأكيد استشارة جديدة للتو.`,
    dateLabel: 'التاريخ', timeLabel: 'وقت البدء', durationLabel: 'المدة', minutes: 'دقيقة',
    typeLabel: 'النوع', online: 'عبر الإنترنت', inPerson: 'حضوري', cta: 'عرض الحجز',
    piiNote: 'تتوفر بيانات اتصال العميل في مساحة المستشار الخاصة بك، محمية برمزك السري (PIN).',
  },
};

export function consultantNewBookingEmailHtml(params: {
  consultantName: string;
  scheduledAt?: string | null;
  /** Exact confirmed fields (preferred over scheduledAt when present). */
  consultationDate?: string | null;
  consultationTime?: string | null;
  durationMinutes: number | null;
  meetingMode: 'ONLINE' | 'OFFLINE' | null;
  portalUrl: string;
  lang: EmailLang;
}): string {
  const lang = normalizeEmailLang(params.lang);
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const c = CONSULTANT_NEW_BOOKING_COPY[lang];
  const { date, time } = formatEmailSlot(lang, params);
  const typeText =
    params.meetingMode === 'ONLINE' ? c.online
    : params.meetingMode === 'OFFLINE' ? c.inPerson
    : null;
  const details = [
    date ? `${c.dateLabel} : ${date}` : null,
    time ? `${c.timeLabel} : ${time}` : null,
    params.durationMinutes ? `${c.durationLabel} : ${params.durationMinutes} ${c.minutes}` : null,
    typeText ? `${c.typeLabel} : ${typeText}` : null,
  ].filter(Boolean).join('<br />');

  return layout(`
    <div dir="${dir}">
    ${h1(c.heading)}
    ${p(c.intro(params.consultantName))}
    ${details ? p(`<span style="color:#3f3f46;">${details}</span>`) : ''}
    ${button(params.portalUrl, c.cta)}
    ${p(`<span style="color:#71717a;font-size:13px;">${c.piiNote}</span>`)}
    </div>
  `);
}

/**
 * Pre-session reminder to the CONSULTANT (sent by the consultation-reminders
 * cron as the session approaches). Includes the meeting details when set, or a
 * clear "add your meeting link" warning when the booking is still AWAITING_LINK.
 */
export function consultantSessionReminderEmailHtml(params: {
  consultantName: string;
  when: string | null;
  durationMinutes: number | null;
  meetingMode: 'ONLINE' | 'OFFLINE' | null;
  meetingLink: string | null;
  meetingAddress: string | null;
  /** Zoom host start URL (auto-signs the consultant in as host) — shown instead of the plain join link when set. */
  zoomStartUrl?: string | null;
  awaitingLink: boolean;
  portalUrl: string;
  lang: 'en' | 'fr';
}): string {
  const isFr = params.lang === 'fr';
  const typeLabel =
    params.meetingMode === 'ONLINE' ? (isFr ? 'En ligne' : 'Online')
    : params.meetingMode === 'OFFLINE' ? (isFr ? 'En présentiel' : 'In person')
    : null;
  const linkRow = params.zoomStartUrl
    ? `${isFr ? 'Démarrer la réunion (hôte)' : 'Start meeting (host)'} : <a href="${params.zoomStartUrl}" style="color:#30a735;">${params.zoomStartUrl}</a>`
    : params.meetingLink
      ? `${isFr ? 'Lien de la réunion' : 'Meeting link'} : <a href="${params.meetingLink}" style="color:#30a735;">${params.meetingLink}</a>`
      : null;
  const details = [
    params.when ? `${isFr ? 'Date' : 'Date'} : ${params.when}` : null,
    params.durationMinutes ? `${isFr ? 'Durée' : 'Duration'} : ${params.durationMinutes} min` : null,
    typeLabel ? `${isFr ? 'Type' : 'Type'} : ${typeLabel}` : null,
    linkRow,
    params.meetingAddress ? `${isFr ? 'Adresse' : 'Address'} : ${params.meetingAddress}` : null,
  ].filter(Boolean).join('<br />');

  return layout(`
    ${h1(isFr ? 'Rappel — consultation à venir' : 'Reminder — upcoming consultation')}
    ${p(isFr
      ? `Bonjour ${params.consultantName}, votre consultation approche.`
      : `Hello ${params.consultantName}, your consultation is coming up.`)}
    ${details ? p(`<span style="color:#3f3f46;">${details}</span>`) : ''}
    ${params.awaitingLink
      ? p(`<span style="color:#92400e;font-weight:600;">${isFr
          ? '⚠ Aucun lien de réunion n’est encore défini pour cette session. Ajoutez-le depuis votre espace consultant pour que votre client puisse vous rejoindre.'
          : '⚠ No meeting link is set for this session yet. Add it from your consultant portal so your client can join.'}</span>`)
      : ''}
    ${button(params.portalUrl, isFr ? 'Ouvrir mon espace consultant' : 'Open my consultant portal')}
    ${p(`<span style="color:#71717a;font-size:13px;">${isFr
      ? 'Les coordonnées du client sont disponibles dans votre espace consultant, protégé par votre code PIN.'
      : 'The client’s contact details are available in your consultant portal, protected by your PIN.'}</span>`)}
  `);
}

/** Sent to the user when their booking is created (awaiting incubator approval). */
export function bookingPendingEmailHtml(opts: {
  customerName: string;
  bookingId: string;
  itemName: string;
  itemKind: string;
  vendorName: string;
  city: string;
  startsAt: string;
  endsAt: string;
  totalAmount: number;
  createdAt: string;
}): string {
  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const formatAmount = (n: number) => (n === 0 ? 'Free' : `${n.toLocaleString()} DZD`);

  return layout(`
    ${h1('Booking Request Received ⏳')}
    ${p(`Hi <strong>${opts.customerName}</strong>, your booking request has been received and is awaiting approval from <strong>${opts.vendorName}</strong>.`)}
    ${p('Your payment has been held in escrow and will be credited to the provider upon confirmation, or fully refunded if declined.')}
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e4e4e7;border-radius:8px;overflow:hidden;margin:20px 0;">
      <tr style="background:#f9fafb;">
        <td style="padding:12px 16px;font-size:13px;color:#71717a;font-weight:600;width:40%;">Service</td>
        <td style="padding:12px 16px;font-size:14px;color:#09090b;font-weight:500;">${opts.itemName}</td>
      </tr>
      <tr>
        <td style="padding:12px 16px;font-size:13px;color:#71717a;font-weight:600;border-top:1px solid #e4e4e7;">Provider</td>
        <td style="padding:12px 16px;font-size:14px;color:#09090b;border-top:1px solid #e4e4e7;">${opts.vendorName}</td>
      </tr>
      <tr style="background:#f9fafb;">
        <td style="padding:12px 16px;font-size:13px;color:#71717a;font-weight:600;border-top:1px solid #e4e4e7;">Location</td>
        <td style="padding:12px 16px;font-size:14px;color:#09090b;border-top:1px solid #e4e4e7;">${opts.city}</td>
      </tr>
      <tr>
        <td style="padding:12px 16px;font-size:13px;color:#71717a;font-weight:600;border-top:1px solid #e4e4e7;">Start date</td>
        <td style="padding:12px 16px;font-size:14px;color:#09090b;border-top:1px solid #e4e4e7;">${formatDate(opts.startsAt)}</td>
      </tr>
      <tr style="background:#fff9e6;border-top:1px solid #e4e4e7;">
        <td style="padding:14px 16px;font-size:14px;color:#92400e;font-weight:700;border-top:1px solid #e4e4e7;">Amount held</td>
        <td style="padding:14px 16px;font-size:16px;color:#92400e;font-weight:700;border-top:1px solid #e4e4e7;">${formatAmount(opts.totalAmount)}</td>
      </tr>
    </table>
    ${p(`<span style="color:#71717a;font-size:13px;">Reference: <code style="background:#f4f4f5;padding:2px 6px;border-radius:4px;font-family:monospace;">${opts.bookingId.slice(0, 8).toUpperCase()}</code> &nbsp;·&nbsp; Submitted ${formatDate(opts.createdAt)}</span>`)}
    ${p('We will notify you by email once the provider responds. You can also check your booking status in your dashboard.')}
  `);
}

/** Sent to the user when their booking is confirmed — includes a QR code. */
export function bookingConfirmedWithQrEmailHtml(opts: {
  customerName: string;
  bookingId: string;
  itemName: string;
  itemKind: string;
  vendorName: string;
  city: string;
  startsAt: string;
  endsAt: string;
  totalAmount: number;
  createdAt: string;
}): string {
  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const formatAmount = (n: number) => (n === 0 ? 'Free' : `${n.toLocaleString()} DZD`);
  const qrData = encodeURIComponent(`METWORK:${opts.bookingId}`);
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${qrData}`;

  return layout(`
    ${h1('Booking Confirmed! 🎉')}
    ${p(`Hi <strong>${opts.customerName}</strong>, your booking has been confirmed. Show the QR code below at the venue.`)}
    <div style="text-align:center;margin:28px 0;">
      <img src="${qrUrl}" width="180" height="180" alt="Booking QR Code" style="border-radius:8px;border:1px solid #e4e4e7;" />
      <p style="margin:8px 0 0;font-size:12px;color:#71717a;font-family:monospace;">${opts.bookingId.slice(0, 8).toUpperCase()}</p>
    </div>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e4e4e7;border-radius:8px;overflow:hidden;margin:20px 0;">
      <tr style="background:#f9fafb;">
        <td style="padding:12px 16px;font-size:13px;color:#71717a;font-weight:600;width:40%;">Service</td>
        <td style="padding:12px 16px;font-size:14px;color:#09090b;font-weight:500;">${opts.itemName}</td>
      </tr>
      <tr>
        <td style="padding:12px 16px;font-size:13px;color:#71717a;font-weight:600;border-top:1px solid #e4e4e7;">Provider</td>
        <td style="padding:12px 16px;font-size:14px;color:#09090b;border-top:1px solid #e4e4e7;">${opts.vendorName}</td>
      </tr>
      <tr style="background:#f9fafb;">
        <td style="padding:12px 16px;font-size:13px;color:#71717a;font-weight:600;border-top:1px solid #e4e4e7;">Location</td>
        <td style="padding:12px 16px;font-size:14px;color:#09090b;border-top:1px solid #e4e4e7;">${opts.city}</td>
      </tr>
      <tr>
        <td style="padding:12px 16px;font-size:13px;color:#71717a;font-weight:600;border-top:1px solid #e4e4e7;">Start</td>
        <td style="padding:12px 16px;font-size:14px;color:#09090b;border-top:1px solid #e4e4e7;">${formatDate(opts.startsAt)}</td>
      </tr>
      <tr style="background:#f4fdf7;">
        <td style="padding:14px 16px;font-size:14px;color:#166534;font-weight:700;border-top:1px solid #e4e4e7;">Amount paid</td>
        <td style="padding:14px 16px;font-size:16px;color:#166534;font-weight:700;border-top:1px solid #e4e4e7;">${formatAmount(opts.totalAmount)}</td>
      </tr>
    </table>
    ${p('Present this email or QR code at the venue reception. If you have questions, contact the provider directly.')}
  `);
}

/** Sent to the user when their booking is declined. */
export function bookingDeclinedEmailHtml(opts: {
  customerName: string;
  bookingId: string;
  itemName: string;
  itemKind: string;
  vendorName: string;
  totalAmount: number;
  declineReason?: string;
}): string {
  const formatAmount = (n: number) => (n === 0 ? 'Free' : `${n.toLocaleString()} DZD`);

  return layout(`
    ${h1('Booking Not Approved')}
    ${p(`Hi <strong>${opts.customerName}</strong>, unfortunately <strong>${opts.vendorName}</strong> was unable to confirm your booking for <strong>${opts.itemName}</strong>.`)}
    ${opts.declineReason ? `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;margin:20px 0;"><p style="margin:0;font-size:14px;color:#991b1b;"><strong>Reason:</strong> ${opts.declineReason.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p></div>` : ''}
    ${opts.totalAmount > 0 ? p(`<strong style="color:#166534;">Refund: ${formatAmount(opts.totalAmount)}</strong> has been returned to your Metwork wallet.`) : ''}
    ${p('You can browse other available spaces and programs on the platform. If you believe this was an error, please contact the provider directly.')}
    ${p(`<span style="color:#71717a;font-size:13px;">Reference: <code style="background:#f4f4f5;padding:2px 6px;border-radius:4px;font-family:monospace;">${opts.bookingId.slice(0, 8).toUpperCase()}</code></span>`)}
  `);
}

/**
 * Sent to the client when the provider cancels their UNPAID (awaiting-payment)
 * booking. Unlike the declined email, it explicitly states no payment was taken
 * — there is no refund because nothing was ever charged. Localised (en/fr/ar).
 */
export function bookingCancelledUnpaidEmailHtml(
  opts: { customerName: string; bookingId: string; itemName: string; vendorName: string },
  lang: 'en' | 'fr' | 'ar' = 'en',
): string {
  const ref = opts.bookingId.slice(0, 8).toUpperCase();
  const refRow = (label: string) =>
    p(`<span style="color:#71717a;font-size:13px;">${label}: <code style="background:#f4f4f5;padding:2px 6px;border-radius:4px;font-family:monospace;">${ref}</code></span>`);

  if (lang === 'fr') {
    return layout(`
      ${h1('Réservation annulée')}
      ${p(`Bonjour <strong>${opts.customerName}</strong>, votre réservation non payée pour <strong>${opts.itemName}</strong> auprès de <strong>${opts.vendorName}</strong> a été annulée.`)}
      ${p('<strong>Aucun paiement n’a été prélevé</strong> — il n’y a donc aucun remboursement. Vous pouvez réserver à nouveau à tout moment.')}
      ${refRow('Référence')}
    `);
  }
  if (lang === 'ar') {
    return layout(`
      ${h1('تم إلغاء الحجز')}
      ${p(`مرحبًا <strong>${opts.customerName}</strong>، تم إلغاء حجزك غير المدفوع لـ <strong>${opts.itemName}</strong> لدى <strong>${opts.vendorName}</strong>.`)}
      ${p('<strong>لم يتم تحصيل أي دفعة</strong> — لذلك لا يوجد أي استرداد. يمكنك الحجز مرة أخرى في أي وقت.')}
      ${refRow('المرجع')}
    `);
  }
  return layout(`
    ${h1('Booking cancelled')}
    ${p(`Hi <strong>${opts.customerName}</strong>, your unpaid booking for <strong>${opts.itemName}</strong> with <strong>${opts.vendorName}</strong> has been cancelled.`)}
    ${p('<strong>No payment was taken</strong>, so there is nothing to refund. You can book again any time.')}
    ${refRow('Reference')}
  `);
}

/**
 * Sent to the client when the provider EDITS their manual/offline booking.
 * Shows the new schedule + amount. No payment/refund language (settled offline).
 * Localised (en/fr/ar).
 */
export function bookingUpdatedEmailHtml(
  opts: {
    customerName: string;
    bookingId: string;
    itemName: string;
    vendorName: string;
    startsAt: string;
    endsAt: string;
    totalAmount: number;
  },
  lang: 'en' | 'fr' | 'ar' = 'fr',
): string {
  const isFr = lang === 'fr';
  const isAr = lang === 'ar';
  const dir = isAr ? 'rtl' : 'ltr';
  const ref = opts.bookingId.slice(0, 8).toUpperCase();
  const locale = isFr ? 'fr-DZ' : isAr ? 'ar-DZ' : 'en-GB';
  const fmtDt = (iso: string) => {
    try {
      return new Date(iso).toLocaleString(locale, {
        day: '2-digit', month: 'long', year: 'numeric',
        hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
      });
    } catch { return iso; }
  };
  const fmtAmt = (n: number) =>
    n === 0 ? (isFr ? 'Gratuit' : isAr ? 'مجاني' : 'Free') : `${n.toLocaleString('fr-DZ')} DZD`;

  const L = isFr
    ? { title: 'Réservation modifiée', greeting: `Bonjour ${opts.customerName},`,
        body: `Votre réservation chez <strong>${opts.vendorName}</strong> a été mise à jour. Voici les nouveaux détails :`,
        item: 'Prestation', from: 'Du', to: 'Au', total: 'Total', reference: 'Référence' }
    : isAr
    ? { title: 'تم تعديل الحجز', greeting: `مرحبًا ${opts.customerName},`,
        body: `تم تحديث حجزك لدى <strong>${opts.vendorName}</strong>. إليك التفاصيل الجديدة:`,
        item: 'الخدمة', from: 'من', to: 'إلى', total: 'الإجمالي', reference: 'المرجع' }
    : { title: 'Booking updated', greeting: `Hi ${opts.customerName},`,
        body: `Your booking with <strong>${opts.vendorName}</strong> has been updated. Here are the new details:`,
        item: 'Item', from: 'From', to: 'To', total: 'Total', reference: 'Reference' };

  const rows: Array<[string, string]> = [
    [L.item, opts.itemName],
    [L.from, fmtDt(opts.startsAt)],
    [L.to, fmtDt(opts.endsAt)],
    [L.total, fmtAmt(opts.totalAmount)],
    [L.reference, ref],
  ];
  const tableRows = rows
    .map(([label, value]) =>
      `<tr>
         <td style="padding:8px 12px;font-size:13px;color:#71717a;border-bottom:1px solid #f4f4f5;width:140px;">${label}</td>
         <td style="padding:8px 12px;font-size:13px;color:#09090b;border-bottom:1px solid #f4f4f5;font-weight:500;">${value}</td>
       </tr>`,
    )
    .join('');

  return layout(`
    <div dir="${dir}">
    ${h1(L.title)}
    ${p(L.greeting)}
    ${p(L.body)}
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e4e4e7;border-radius:8px;overflow:hidden;margin:20px 0;">
      ${tableRows}
    </table>
    </div>
  `);
}

/**
 * Sent to the client when the provider DELETES their manual/offline booking.
 * No refund language (manual bookings settle offline). Localised (en/fr/ar).
 */
export function bookingProviderCancelledEmailHtml(
  opts: { customerName: string; bookingId: string; itemName: string; vendorName: string },
  lang: 'en' | 'fr' | 'ar' = 'fr',
): string {
  const isFr = lang === 'fr';
  const isAr = lang === 'ar';
  const ref = opts.bookingId.slice(0, 8).toUpperCase();
  const refRow = (label: string) =>
    p(`<span style="color:#71717a;font-size:13px;">${label}: <code style="background:#f4f4f5;padding:2px 6px;border-radius:4px;font-family:monospace;">${ref}</code></span>`);

  if (isFr) {
    return layout(`
      ${h1('Réservation annulée')}
      ${p(`Bonjour <strong>${opts.customerName}</strong>, votre réservation pour <strong>${opts.itemName}</strong> auprès de <strong>${opts.vendorName}</strong> a été annulée.`)}
      ${p('Si vous avez des questions, veuillez contacter directement le prestataire.')}
      ${refRow('Référence')}
    `);
  }
  if (isAr) {
    return layout(`
      <div dir="rtl">
      ${h1('تم إلغاء الحجز')}
      ${p(`مرحبًا <strong>${opts.customerName}</strong>، تم إلغاء حجزك لـ <strong>${opts.itemName}</strong> لدى <strong>${opts.vendorName}</strong>.`)}
      ${p('إذا كان لديك أي أسئلة، يرجى التواصل مباشرة مع مقدّم الخدمة.')}
      ${refRow('المرجع')}
      </div>
    `);
  }
  return layout(`
    ${h1('Booking cancelled')}
    ${p(`Hi <strong>${opts.customerName}</strong>, your booking for <strong>${opts.itemName}</strong> with <strong>${opts.vendorName}</strong> has been cancelled.`)}
    ${p('If you have any questions, please contact the provider directly.')}
    ${refRow('Reference')}
  `);
}

/** Sent to the incubator when a new booking arrives. */
export function newBookingAlertHtml(opts: {
  incubatorName: string;
  customerName: string;
  bookingId: string;
  itemName: string;
  itemKind: string;
  startsAt: string;
  endsAt: string;
  totalAmount: number;
  dashboardUrl: string;
}): string {
  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const formatAmount = (n: number) => (n === 0 ? 'Free' : `${n.toLocaleString()} DZD`);

  return layout(`
    ${h1(`New Booking — ${opts.itemName}`)}
    ${p(`<strong>${opts.incubatorName}</strong> has received a new booking request.`)}
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e4e4e7;border-radius:8px;overflow:hidden;margin:20px 0;">
      <tr style="background:#f9fafb;">
        <td style="padding:12px 16px;font-size:13px;color:#71717a;font-weight:600;width:40%;">Customer</td>
        <td style="padding:12px 16px;font-size:14px;color:#09090b;font-weight:500;">${opts.customerName}</td>
      </tr>
      <tr>
        <td style="padding:12px 16px;font-size:13px;color:#71717a;font-weight:600;border-top:1px solid #e4e4e7;">Service</td>
        <td style="padding:12px 16px;font-size:14px;color:#09090b;border-top:1px solid #e4e4e7;">${opts.itemName}</td>
      </tr>
      <tr style="background:#f9fafb;">
        <td style="padding:12px 16px;font-size:13px;color:#71717a;font-weight:600;border-top:1px solid #e4e4e7;">Date</td>
        <td style="padding:12px 16px;font-size:14px;color:#09090b;border-top:1px solid #e4e4e7;">${formatDate(opts.startsAt)}</td>
      </tr>
      <tr style="background:#f4fdf7;">
        <td style="padding:14px 16px;font-size:14px;color:#166534;font-weight:700;border-top:1px solid #e4e4e7;">Amount</td>
        <td style="padding:14px 16px;font-size:16px;color:#166534;font-weight:700;border-top:1px solid #e4e4e7;">${formatAmount(opts.totalAmount)}</td>
      </tr>
    </table>
    ${p('Approve or decline this booking from your dashboard.')}
    ${button(opts.dashboardUrl, 'Review Bookings')}
    ${p(`<span style="color:#71717a;font-size:13px;">Reference: <code style="background:#f4f4f5;padding:2px 6px;border-radius:4px;font-family:monospace;">${opts.bookingId.slice(0, 8).toUpperCase()}</code></span>`)}
  `);
}

/**
 * Bilingual (FR/EN) "rental ending soon" reminder for the incubator — sent a
 * day or two before a COWORKING desk / PRIVATE_OFFICE booking ends, prompting
 * the manager to extend or release the unit. Pure HTML builder (no I/O).
 */
export function spaceExpiryReminderEmailHtml(payload: {
  incubatorName: string;
  clientName: string;
  deskName: string;
  spaceName: string;
  endDate: string;
  bookingId: string;
}): string {
  const dashboardUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://metwork.dz'}/dashboard/incubator/bookings`;
  const ref = payload.bookingId.slice(0, 8).toUpperCase();
  const esc = (s: string) => s.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const row = (label: string, value: string) =>
    `<tr>
       <td style="padding:10px 16px;font-size:13px;color:#71717a;font-weight:600;border-top:1px solid #e4e4e7;width:42%;">${label}</td>
       <td style="padding:10px 16px;font-size:14px;color:#09090b;border-top:1px solid #e4e4e7;">${esc(value)}</td>
     </tr>`;

  return layout(`
    ${h1('Location se terminant bientôt / Rental ending soon')}
    ${p(`Bonjour <strong>${esc(payload.incubatorName)}</strong>, une location arrive à échéance. / Hello <strong>${esc(payload.incubatorName)}</strong>, one of your rentals is ending soon.`)}
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e4e4e7;border-radius:8px;overflow:hidden;margin:20px 0;">
      ${row('Client', payload.clientName)}
      ${row('Poste / bureau · Desk / office', payload.deskName)}
      ${row('Espace · Space', payload.spaceName)}
      ${row('Fin · End date', payload.endDate)}
    </table>
    ${p('Souhaitez-vous prolonger la location ou libérer l’espace ? / Do you wish to extend the rental or release the space?')}
    ${button(dashboardUrl, 'Voir la réservation / View booking')}
    ${p(`<span style="color:#71717a;font-size:13px;">Référence · Reference: <code style="background:#f4f4f5;padding:2px 6px;border-radius:4px;font-family:monospace;">${ref}</code></span>`)}
  `);
}

/**
 * Fire-and-forget sender for the space-expiry reminder. NEVER throws and NEVER
 * blocks the caller — failures are swallowed (logged) so the cron path can mark
 * the reminder sent without risking a 500. Resend is best-effort; absent an API
 * key it logs for ops visibility, matching every other sender here.
 */
export function sendSpaceExpiryReminderEmail(
  to: string,
  payload: {
    incubatorName: string;
    clientName: string;
    deskName: string;
    spaceName: string;
    endDate: string;
    bookingId: string;
  },
): void {
  const subject = 'Rappel — Location se terminant bientôt / Reminder — Rental ending soon';
  void (async () => {
    try {
      const html = spaceExpiryReminderEmailHtml(payload);
      const delivered = await sendResendEmail({ to, subject, html });
      if (!delivered) console.log('[email/space-expiry-reminder]', { to, subject, bookingId: payload.bookingId });
    } catch (err) {
      console.error('[email/space-expiry-reminder] send failed', err);
    }
  })();
}

export function consultationApprovedEmailHtml(opts: {
  userName: string;
  mentorName: string;
  scheduledAt: string | null;
  meetLink: string | null;
  adminNote?: string;
}): string {
  const formatDt = (iso: string) =>
    new Date(iso).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' });

  return layout(`
    ${h1('Your consultation is confirmed ✅')}
    ${p(`Hi <strong>${opts.userName}</strong>, your session with <strong>${opts.mentorName}</strong> has been approved.`)}
    ${opts.scheduledAt ? `
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px 20px;margin:20px 0;">
      <p style="margin:0 0 6px;font-size:13px;color:#166534;font-weight:600;">Session date &amp; time</p>
      <p style="margin:0;font-size:16px;color:#15803d;font-weight:700;">${formatDt(opts.scheduledAt)}</p>
    </div>` : ''}
    ${opts.meetLink ? `
    <div style="margin:20px 0;">
      ${p('Join your session using the link below:')}
      ${button(opts.meetLink, '📹 Join Google Meet')}
      <p style="margin:12px 0 0;font-size:12px;color:#71717a;word-break:break-all;">${opts.meetLink}</p>
    </div>` : ''}
    ${opts.adminNote ? `${p(`<strong>Note from admin:</strong> ${opts.adminNote}`)}` : ''}
    ${p('<span style="color:#71717a;font-size:13px;">Please be ready 5 minutes before the session starts. If you need to reschedule, contact us.</span>')}
  `);
}

export function withdrawalProcessedEmailHtml(opts: {
  userName: string;
  amount: number;
  status: 'APPROVED' | 'REJECTED';
  adminNote?: string;
}): string {
  const fmtAmt = `${opts.amount.toLocaleString()} DZD`;
  const approved = opts.status === 'APPROVED';

  return layout(`
    ${h1(approved ? 'Withdrawal processed ✅' : 'Withdrawal request update')}
    ${p(`Hi <strong>${opts.userName}</strong>,`)}
    ${approved
      ? p(`Your withdrawal request for <strong>${fmtAmt}</strong> has been <strong style="color:#166534;">approved</strong> and will be transferred to your registered account within 1-3 business days.`)
      : p(`Your withdrawal request for <strong>${fmtAmt}</strong> has been <strong style="color:#dc2626;">declined</strong> and the amount has been returned to your Metwork wallet.`)}
    ${opts.adminNote ? `
    <div style="background:#f9fafb;border:1px solid #e4e4e7;border-radius:8px;padding:16px 20px;margin:20px 0;">
      <p style="margin:0 0 4px;font-size:13px;color:#71717a;font-weight:600;">Note</p>
      <p style="margin:0;font-size:14px;color:#3f3f46;">${opts.adminNote}</p>
    </div>` : ''}
    ${p('<span style="color:#71717a;font-size:13px;">If you have questions, please contact our support team.</span>')}
  `);
}

/**
 * Sent when an admin approves a manual withdrawal (bank transfer / CCP /
 * cheque). Localised (en/fr/ar); the copy reflects the chosen method.
 * `method` null = legacy request without a structured method → generic
 * "registered account" wording.
 */
export function withdrawalApprovedEmailHtml(
  opts: {
    name: string;
    amount: number;
    method: 'bank_transfer' | 'ccp' | 'cheque' | null;
    adminNote?: string | null;
  },
  lang: 'en' | 'fr' | 'ar' = 'fr',
): string {
  const fmtAmt = `${opts.amount.toLocaleString('fr-DZ')} DZD`;

  const L =
    lang === 'fr'
      ? {
          title: 'Retrait traité ✅',
          greeting: `Bonjour <strong>${opts.name}</strong>,`,
          processed: `Votre demande de retrait de <strong>${fmtAmt}</strong> a été traitée.`,
          byMethod: {
            bank_transfer:
              'Les fonds seront disponibles sur votre compte bancaire dans un délai de 3 jours ouvrables.',
            ccp: 'Les fonds seront disponibles sur votre compte CCP dans un délai de 3 jours ouvrables.',
            cheque: 'Votre chèque sera disponible dans un délai de 3 jours ouvrables.',
            fallback:
              'Les fonds seront disponibles sur le compte que vous avez choisi dans un délai de 3 jours ouvrables.',
          },
          noteLabel: 'Note',
          footer: 'Pour toute question, contactez notre équipe support.',
        }
      : lang === 'ar'
        ? {
            title: 'تمت معالجة طلب السحب ✅',
            greeting: `مرحبًا <strong>${opts.name}</strong>،`,
            processed: `تمت معالجة طلب السحب الخاص بك بقيمة <strong>${fmtAmt}</strong>.`,
            byMethod: {
              bank_transfer: 'ستكون الأموال متاحة في حسابك البنكي في غضون 3 أيام عمل.',
              ccp: 'ستكون الأموال متاحة في حسابك البريدي الجاري (CCP) في غضون 3 أيام عمل.',
              cheque: 'سيكون الشيك الخاص بك جاهزًا في غضون 3 أيام عمل.',
              fallback: 'ستكون الأموال متاحة في الحساب الذي اخترته في غضون 3 أيام عمل.',
            },
            noteLabel: 'ملاحظة',
            footer: 'لأي استفسار، يرجى التواصل مع فريق الدعم.',
          }
        : {
            title: 'Withdrawal processed ✅',
            greeting: `Hi <strong>${opts.name}</strong>,`,
            processed: `Your withdrawal request for <strong>${fmtAmt}</strong> has been processed.`,
            byMethod: {
              bank_transfer:
                'The funds will be available in your bank account within 3 business days.',
              ccp: 'The funds will be available in your CCP account within 3 business days.',
              cheque: 'Your cheque will be ready within 3 business days.',
              fallback:
                'The funds will be available in your chosen account within 3 business days.',
            },
            noteLabel: 'Note',
            footer: 'If you have questions, please contact our support team.',
          };

  const methodLine = opts.method ? L.byMethod[opts.method] : L.byMethod.fallback;
  const dir = lang === 'ar' ? 'rtl' : 'ltr';

  return layout(`
    <div dir="${dir}">
    ${h1(L.title)}
    ${p(L.greeting)}
    ${p(`${L.processed} ${methodLine}`)}
    ${opts.adminNote ? `
    <div style="background:#f9fafb;border:1px solid #e4e4e7;border-radius:8px;padding:16px 20px;margin:20px 0;">
      <p style="margin:0 0 4px;font-size:13px;color:#71717a;font-weight:600;">${L.noteLabel}</p>
      <p style="margin:0;font-size:14px;color:#3f3f46;">${opts.adminNote}</p>
    </div>` : ''}
    ${p(`<span style="color:#71717a;font-size:13px;">${L.footer}</span>`)}
    </div>
  `);
}

export function withdrawalRequestedEmailHtml(opts: {
  userName: string;
  amount: number;
  accountDetails: string;
}): string {
  return layout(`
    ${h1('Withdrawal request received')}
    ${p(`Hi <strong>${opts.userName}</strong>, we've received your withdrawal request for <strong>${opts.amount.toLocaleString()} DZD</strong>.`)}
    <div style="background:#f9fafb;border:1px solid #e4e4e7;border-radius:8px;padding:16px 20px;margin:20px 0;">
      <p style="margin:0 0 4px;font-size:13px;color:#71717a;font-weight:600;">Transfer to</p>
      <p style="margin:0;font-size:14px;color:#3f3f46;white-space:pre-line;">${opts.accountDetails}</p>
    </div>
    ${p('Our team will review your request and process the transfer within 1-3 business days. You will receive another email once it is approved.')}
    ${p('<span style="color:#71717a;font-size:13px;">Funds have been placed on hold in your wallet pending review.</span>')}
  `);
}

export function contactNotificationHtml(name: string, email: string, message: string): string {
  return layout(`
    ${h1('New contact form submission')}
    ${p(`<strong>From:</strong> ${name} &lt;${email}&gt;`)}
    <div style="background:#f4f4f5;border-radius:8px;padding:20px;margin:16px 0;">
      <p style="margin:0;font-size:14px;color:#3f3f46;line-height:1.7;white-space:pre-wrap;">${message.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>
    </div>
    ${p(`<a href="mailto:${email}" style="color:#166534;">Reply to ${name}</a>`)}
  `);
}

/* ─────────────────── Booking receipt email bodies ─────────────────── */

interface ReceiptEmailParams {
  clientName:     string;
  incubatorName:  string;
  itemName:       string;
  reference:      string;
  startsAt:       string;
  endsAt:         string;
  totalAmount:    number;
  paymentMethod:  string;
  lang:           'en' | 'fr';
}

export function bookingReceiptEmailHtml(params: ReceiptEmailParams): string {
  const {
    clientName, incubatorName, itemName, reference,
    startsAt, endsAt, totalAmount, paymentMethod, lang,
  } = params;

  const isFr = lang === 'fr';

  function fmtDt(iso: string): string {
    try {
      return new Date(iso).toLocaleString(isFr ? 'fr-DZ' : 'en-GB', {
        day: '2-digit', month: 'long', year: 'numeric',
        hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
      });
    } catch { return iso; }
  }

  const fmtAmt = (n: number) =>
    n === 0
      ? (isFr ? 'Gratuit' : 'Free')
      : n.toLocaleString('fr-DZ') + ' DZD';

  const greeting = isFr
    ? `Bonjour ${clientName},`
    : `Hello ${clientName},`;

  const bodyText = isFr
    ? `Votre réservation chez <strong>${incubatorName}</strong> a été confirmée avec succès. Veuillez trouver ci-joint votre reçu PDF.`
    : `Your booking with <strong>${incubatorName}</strong> has been confirmed. Please find your PDF receipt attached.`;

  const rows = [
    [isFr ? 'Prestation'       : 'Item',           itemName],
    [isFr ? 'Du'               : 'From',            fmtDt(startsAt)],
    [isFr ? 'Au'               : 'To',              fmtDt(endsAt)],
    [isFr ? 'Mode de paiement' : 'Payment method',  paymentMethod],
    [isFr ? 'Total'            : 'Total',           fmtAmt(totalAmount)],
    [isFr ? 'Référence'        : 'Reference',       reference],
  ];

  const tableRows = rows
    .map(([label, value]) =>
      `<tr>
         <td style="padding:8px 12px;font-size:13px;color:#71717a;border-bottom:1px solid #f4f4f5;width:140px;">${label}</td>
         <td style="padding:8px 12px;font-size:13px;color:#09090b;border-bottom:1px solid #f4f4f5;font-weight:500;">${value ?? '—'}</td>
       </tr>`,
    )
    .join('');

  const title = isFr ? 'Votre reçu de réservation' : 'Your booking receipt';

  return layout(`
    ${h1(title)}
    ${p(greeting)}
    ${p(bodyText)}
    <table width="100%" cellpadding="0" cellspacing="0"
           style="border:1px solid #e4e4e7;border-radius:8px;overflow:hidden;margin:20px 0;">
      ${tableRows}
    </table>
    ${p(`<span style="color:#71717a;font-size:13px;">
      ${isFr
        ? 'Ce reçu est votre preuve de paiement. Conservez-le précieusement.'
        : 'This receipt is your proof of payment. Please keep it for your records.'}
    </span>`)}
  `);
}

/* ─────────────────── Payment-link email bodies ─────────────────── */

interface PaymentLinkReceiptEmailParams {
  payerName:      string;
  incubatorName:  string;
  serviceName:    string;
  reference:      string;
  amount:         number;
  payerFee:       number;
  grossCharge:    number;
  lang:           'en' | 'fr';
}

/** Receipt email sent to the (account-less) payer after a successful payment. */
export function paymentLinkReceiptEmailHtml(params: PaymentLinkReceiptEmailParams): string {
  const { payerName, incubatorName, serviceName, reference, amount, payerFee, grossCharge, lang } = params;
  const isFr = lang === 'fr';
  const fmtAmt = (n: number) => n.toLocaleString('fr-DZ') + ' DZD';

  const greeting = isFr ? `Bonjour ${payerName},` : `Hello ${payerName},`;
  const bodyText = isFr
    ? `Votre paiement à <strong>${incubatorName}</strong> a bien été reçu. Vous trouverez votre reçu PDF en pièce jointe.`
    : `Your payment to <strong>${incubatorName}</strong> has been received. Please find your PDF receipt attached.`;

  const rows: Array<[string, string]> = [
    [isFr ? 'Prestation' : 'Service', serviceName],
    [isFr ? 'Montant' : 'Amount', fmtAmt(amount)],
  ];
  if (payerFee > 0) {
    rows.push([isFr ? 'Frais de plateforme' : 'Platform fee', `+ ${fmtAmt(payerFee)}`]);
    rows.push([isFr ? 'Total payé' : 'Total paid', fmtAmt(grossCharge)]);
  } else {
    rows.push([isFr ? 'Total payé' : 'Total paid', fmtAmt(grossCharge)]);
  }
  rows.push([isFr ? 'Référence' : 'Reference', reference]);

  const tableRows = rows
    .map(([label, value]) =>
      `<tr>
         <td style="padding:8px 12px;font-size:13px;color:#71717a;border-bottom:1px solid #f4f4f5;width:140px;">${label}</td>
         <td style="padding:8px 12px;font-size:13px;color:#09090b;border-bottom:1px solid #f4f4f5;font-weight:500;">${value ?? '—'}</td>
       </tr>`,
    )
    .join('');

  const title = isFr ? 'Votre reçu de paiement' : 'Your payment receipt';

  return layout(`
    ${h1(title)}
    ${p(greeting)}
    ${p(bodyText)}
    <table width="100%" cellpadding="0" cellspacing="0"
           style="border:1px solid #e4e4e7;border-radius:8px;overflow:hidden;margin:20px 0;">
      ${tableRows}
    </table>
    ${p(`<span style="color:#71717a;font-size:13px;">
      ${isFr
        ? 'Ce reçu est votre preuve de paiement. Conservez-le précieusement.'
        : 'This receipt is your proof of payment. Please keep it for your records.'}
    </span>`)}
  `);
}

interface PaymentLinkPaidEmailParams {
  incubatorName:  string;
  serviceName:    string;
  payerName:      string;
  payerEmail:     string;
  reference:      string;
  /** Net amount credited to the incubator wallet (amount − commission). */
  netAmount:      number;
  amount:         number;
  commission:     number;
  dashboardUrl:   string;
  lang:           'en' | 'fr';
}

/** "New payment received" email sent to the incubator owner. */
export function paymentLinkPaidEmailHtml(params: PaymentLinkPaidEmailParams): string {
  const { serviceName, payerName, payerEmail, reference, netAmount, amount, commission, dashboardUrl, lang } = params;
  const isFr = lang === 'fr';
  const fmtAmt = (n: number) => n.toLocaleString('fr-DZ') + ' DZD';

  const rows: Array<[string, string]> = [
    [isFr ? 'Prestation' : 'Service', serviceName],
    [isFr ? 'Client' : 'Payer', `${payerName} (${payerEmail})`],
    [isFr ? 'Montant' : 'Amount', fmtAmt(amount)],
  ];
  if (commission > 0) {
    rows.push([isFr ? 'Commission plateforme' : 'Platform commission', `− ${fmtAmt(commission)}`]);
  }
  rows.push([isFr ? 'Net crédité' : 'Net credited', fmtAmt(netAmount)]);
  rows.push([isFr ? 'Référence' : 'Reference', reference]);

  const tableRows = rows
    .map(([label, value]) =>
      `<tr>
         <td style="padding:8px 12px;font-size:13px;color:#71717a;border-bottom:1px solid #f4f4f5;width:160px;">${label}</td>
         <td style="padding:8px 12px;font-size:13px;color:#09090b;border-bottom:1px solid #f4f4f5;font-weight:500;">${value ?? '—'}</td>
       </tr>`,
    )
    .join('');

  const title = isFr ? 'Nouveau paiement reçu 🎉' : 'New payment received 🎉';
  const bodyText = isFr
    ? `Un client vient de régler un lien de paiement. Le montant net a été crédité sur votre portefeuille Metwork.`
    : `A client just paid one of your payment links. The net amount has been credited to your Metwork wallet.`;

  return layout(`
    ${h1(title)}
    ${p(bodyText)}
    <table width="100%" cellpadding="0" cellspacing="0"
           style="border:1px solid #e4e4e7;border-radius:8px;overflow:hidden;margin:20px 0;">
      ${tableRows}
    </table>
    ${p(`<a href="${dashboardUrl}" style="color:#166534;">${isFr ? 'Voir mon portefeuille' : 'View my wallet'}</a>`)}
  `);
}

interface ConsultEmailParams {
  clientName:      string;
  mentorName:      string;
  reference:       string;
  lang:            'en' | 'fr';
  /** ISO datetime set by admin when approving. */
  scheduledAt?:    string | null;
  /** Duration in minutes (from the booking request or admin). */
  durationMinutes?: number | null;
  /** Estimated fee in DZD after any promo discount. 0 = free. */
  estimatedFee?:   number | null;
  /** Google Meet / Zoom / Teams link provided by admin on approval. */
  meetLink?:       string | null;
  /** True when the session will be in-person (no online link). */
  isOffline?:      boolean;
}

export function consultationConfirmationEmailHtml(params: ConsultEmailParams): string {
  const { clientName, mentorName, reference, lang, scheduledAt, durationMinutes, estimatedFee, meetLink, isOffline } = params;
  const isFr = lang === 'fr';

  const greeting = isFr ? `Bonjour ${clientName},` : `Hello ${clientName},`;
  const bodyText = isFr
    ? `Votre demande de consultation avec <strong>${mentorName}</strong> a été <strong>approuvée</strong>. Vous trouverez les détails ci-dessous ainsi que votre PDF de confirmation en pièce jointe.`
    : `Your consultation request with <strong>${mentorName}</strong> has been <strong>approved</strong>. Please find the details below and your confirmation PDF attached.`;

  const title = isFr ? 'Consultation confirmée ✓' : 'Consultation confirmed ✓';

  // Build optional detail rows
  const schedRow = scheduledAt
    ? `<tr>
        <td style="padding:8px 12px;font-size:13px;color:#71717a;border-bottom:1px solid #f4f4f5;width:140px;">
          ${isFr ? 'Date confirmée' : 'Confirmed date'}
        </td>
        <td style="padding:8px 12px;font-size:13px;color:#09090b;border-bottom:1px solid #f4f4f5;font-weight:500;">
          ${new Date(scheduledAt).toLocaleString(isFr ? 'fr-DZ' : 'en-GB', { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' })}
        </td>
      </tr>`
    : '';

  const durRow = durationMinutes
    ? `<tr>
        <td style="padding:8px 12px;font-size:13px;color:#71717a;border-bottom:1px solid #f4f4f5;width:140px;">
          ${isFr ? 'Durée' : 'Duration'}
        </td>
        <td style="padding:8px 12px;font-size:13px;color:#09090b;border-bottom:1px solid #f4f4f5;font-weight:500;">
          ${durationMinutes} min
        </td>
      </tr>`
    : '';

  const feeRow = estimatedFee != null
    ? `<tr>
        <td style="padding:8px 12px;font-size:13px;color:#71717a;border-bottom:1px solid #f4f4f5;width:140px;">
          ${isFr ? 'Frais estimés' : 'Estimated fee'}
        </td>
        <td style="padding:8px 12px;font-size:13px;color:#09090b;border-bottom:1px solid #f4f4f5;font-weight:500;">
          ${estimatedFee === 0 ? (isFr ? 'Gratuit' : 'Free') : `${estimatedFee.toLocaleString('fr-DZ')} DZD`}
        </td>
      </tr>`
    : '';

  const meetRow = meetLink
    ? `<tr>
        <td style="padding:8px 12px;font-size:13px;color:#71717a;border-bottom:1px solid #f4f4f5;width:140px;">
          ${isFr ? 'Lien de réunion' : 'Meeting link'}
        </td>
        <td style="padding:8px 12px;font-size:13px;border-bottom:1px solid #f4f4f5;font-weight:500;">
          <a href="${meetLink}" style="color:#166534;word-break:break-all;">${meetLink}</a>
        </td>
      </tr>`
    : isOffline
    ? `<tr>
        <td style="padding:8px 12px;font-size:13px;color:#71717a;border-bottom:1px solid #f4f4f5;width:140px;">
          ${isFr ? 'Format' : 'Format'}
        </td>
        <td style="padding:8px 12px;font-size:13px;color:#09090b;border-bottom:1px solid #f4f4f5;font-weight:500;">
          ${isFr ? 'En présentiel' : 'In-person'}
        </td>
      </tr>`
    : '';

  const joinBlock = meetLink
    ? `<div style="margin:24px 0;text-align:center;">
        ${button(meetLink, isFr ? '📹 Rejoindre la réunion' : '📹 Join the meeting')}
        <p style="margin:10px 0 0;font-size:11px;color:#71717a;word-break:break-all;">${meetLink}</p>
      </div>`
    : '';

  return layout(`
    ${h1(title)}
    ${p(greeting)}
    ${p(bodyText)}
    <table width="100%" cellpadding="0" cellspacing="0"
           style="border:1px solid #e4e4e7;border-radius:8px;overflow:hidden;margin:20px 0;">
      <tr>
        <td style="padding:8px 12px;font-size:13px;color:#71717a;border-bottom:1px solid #f4f4f5;width:140px;">
          ${isFr ? 'Consultant' : 'Consultant'}
        </td>
        <td style="padding:8px 12px;font-size:13px;color:#09090b;border-bottom:1px solid #f4f4f5;font-weight:500;">${mentorName}</td>
      </tr>
      ${schedRow}
      ${durRow}
      ${feeRow}
      ${meetRow}
      <tr>
        <td style="padding:8px 12px;font-size:13px;color:#71717a;width:140px;border-top:1px solid #f4f4f5;">
          ${isFr ? 'Référence' : 'Reference'}
        </td>
        <td style="padding:8px 12px;font-size:13px;color:#09090b;font-weight:500;border-top:1px solid #f4f4f5;">
          ${reference.slice(0, 8).toUpperCase()}
        </td>
      </tr>
    </table>
    ${joinBlock}
    ${p(`<span style="color:#71717a;font-size:13px;">
      ${isFr
        ? 'Votre PDF de confirmation est joint à cet email.'
        : 'Your confirmation PDF is attached to this email.'}
    </span>`)}
  `);
}

/* ── New: guest pay link (approved, awaiting online payment) ── */

interface ConsultPayLinkParams {
  clientName:      string;
  mentorName:      string;
  reference:       string;
  payUrl:          string;
  amount:          number;
  expiresAt:       string;
  lang:            'en' | 'fr';
  scheduledAt?:    string | null;
  durationMinutes?: number | null;
  meetLink?:       string | null;
  isOffline?:      boolean;
}

/**
 * Sent to a GUEST after an admin approves their consultation. Contains the
 * confirmed schedule, the amount, and a single-use pay button. NOT a
 * confirmation — the session is only confirmed once payment succeeds.
 */
export function consultationPayLinkEmailHtml(params: ConsultPayLinkParams): string {
  const { clientName, mentorName, reference, payUrl, amount, expiresAt, lang, scheduledAt, durationMinutes, meetLink, isOffline } = params;
  const isFr = lang === 'fr';

  const fmtDt = (iso: string) => {
    try {
      return new Date(iso).toLocaleString(isFr ? 'fr-DZ' : 'en-GB', {
        dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC',
      });
    } catch { return iso; }
  };
  const fmtAmt = `${amount.toLocaleString('fr-DZ')} DZD`;

  const greeting = isFr ? `Bonjour ${clientName},` : `Hello ${clientName},`;
  const title    = isFr ? 'Votre consultation est approuvée — paiement requis' : 'Your consultation is approved — payment required';
  const body     = isFr
    ? `Bonne nouvelle — votre demande de consultation avec <strong>${mentorName}</strong> a été approuvée. Pour confirmer votre créneau, veuillez régler le montant ci-dessous. Votre séance sera confirmée dès réception du paiement.`
    : `Good news — your consultation request with <strong>${mentorName}</strong> has been approved. To lock in your slot, please pay the amount below. Your session is confirmed as soon as payment is received.`;

  const schedRow = scheduledAt
    ? `<tr>
        <td style="padding:8px 12px;font-size:13px;color:#71717a;border-bottom:1px solid #f4f4f5;width:160px;">${isFr ? 'Date confirmée' : 'Confirmed date'}</td>
        <td style="padding:8px 12px;font-size:13px;color:#09090b;border-bottom:1px solid #f4f4f5;font-weight:500;">${fmtDt(scheduledAt)}</td>
      </tr>`
    : '';
  const durRow = durationMinutes
    ? `<tr>
        <td style="padding:8px 12px;font-size:13px;color:#71717a;border-bottom:1px solid #f4f4f5;width:160px;">${isFr ? 'Durée' : 'Duration'}</td>
        <td style="padding:8px 12px;font-size:13px;color:#09090b;border-bottom:1px solid #f4f4f5;font-weight:500;">${durationMinutes} min</td>
      </tr>`
    : '';
  const formatRow = meetLink
    ? `<tr>
        <td style="padding:8px 12px;font-size:13px;color:#71717a;border-bottom:1px solid #f4f4f5;width:160px;">${isFr ? 'Format' : 'Format'}</td>
        <td style="padding:8px 12px;font-size:13px;color:#09090b;border-bottom:1px solid #f4f4f5;font-weight:500;">${isFr ? 'En ligne' : 'Online'}</td>
      </tr>`
    : isOffline
    ? `<tr>
        <td style="padding:8px 12px;font-size:13px;color:#71717a;border-bottom:1px solid #f4f4f5;width:160px;">${isFr ? 'Format' : 'Format'}</td>
        <td style="padding:8px 12px;font-size:13px;color:#09090b;border-bottom:1px solid #f4f4f5;font-weight:500;">${isFr ? 'En présentiel' : 'In-person'}</td>
      </tr>`
    : '';

  return layout(`
    ${h1(title)}
    ${p(greeting)}
    ${p(body)}
    <table width="100%" cellpadding="0" cellspacing="0"
           style="border:1px solid #e4e4e7;border-radius:8px;overflow:hidden;margin:20px 0;">
      <tr>
        <td style="padding:8px 12px;font-size:13px;color:#71717a;border-bottom:1px solid #f4f4f5;width:160px;">${isFr ? 'Consultant' : 'Consultant'}</td>
        <td style="padding:8px 12px;font-size:13px;color:#09090b;border-bottom:1px solid #f4f4f5;font-weight:500;">${mentorName}</td>
      </tr>
      ${schedRow}
      ${durRow}
      ${formatRow}
      <tr style="background:#f4fdf7;">
        <td style="padding:12px;font-size:14px;color:#166534;font-weight:700;border-top:1px solid #e4e4e7;width:160px;">${isFr ? 'Montant à payer' : 'Amount due'}</td>
        <td style="padding:12px;font-size:16px;color:#166534;font-weight:700;border-top:1px solid #e4e4e7;">${fmtAmt}</td>
      </tr>
    </table>
    <div style="margin:24px 0;text-align:center;">
      ${button(payUrl, isFr ? `Payer ${fmtAmt}` : `Pay ${fmtAmt}`)}
      <p style="margin:12px 0 0;font-size:12px;color:#71717a;word-break:break-all;">${payUrl}</p>
    </div>
    ${p(`<span style="color:#71717a;font-size:13px;">${isFr
        ? `Ce lien de paiement sécurisé (CIB / Edahabia) expire le ${fmtDt(expiresAt)}. Référence : `
        : `This secure payment link (CIB / Edahabia) expires on ${fmtDt(expiresAt)}. Reference: `}<code style="background:#f4f4f5;padding:2px 6px;border-radius:4px;font-family:monospace;">${reference.slice(0, 8).toUpperCase()}</code></span>`)}
  `);
}

/* ── New: request received (pending, not yet approved) ── */

interface ConsultRequestParams {
  clientName:       string;
  mentorName:       string;
  reference:        string;
  consultationDate: string | null | undefined;
  consultationTime: string | null | undefined;
  durationMinutes:  number | null | undefined;
  lang:             'en' | 'fr';
}

export function consultationRequestReceivedEmailHtml(params: ConsultRequestParams): string {
  const { clientName, mentorName, reference, consultationDate, consultationTime, durationMinutes, lang } = params;
  const isFr = lang === 'fr';

  const greeting = isFr ? `Bonjour ${clientName},` : `Hello ${clientName},`;
  const title    = isFr ? 'Demande de consultation reçue' : 'Consultation request received';
  const body     = isFr
    ? `Votre demande de consultation avec <strong>${mentorName}</strong> a bien été reçue. Vous recevrez très prochainement un email avec la suite : les détails de la rencontre (lien ou adresse), ou le lien de paiement si un paiement est requis.`
    : `Your consultation request with <strong>${mentorName}</strong> has been received. You will shortly get a follow-up email with next steps: the meeting details (link or address), or the payment link if payment is required.`;

  const slotRow = (consultationDate && consultationTime)
    ? `<tr>
        <td style="padding:8px 12px;font-size:13px;color:#71717a;border-bottom:1px solid #f4f4f5;width:140px;">${isFr ? 'Créneau souhaité' : 'Requested slot'}</td>
        <td style="padding:8px 12px;font-size:13px;color:#09090b;border-bottom:1px solid #f4f4f5;font-weight:500;">${consultationDate} ${consultationTime}${durationMinutes ? ` · ${durationMinutes} min` : ''}</td>
      </tr>`
    : '';

  return layout(`
    ${h1(title)}
    ${p(greeting)}
    ${p(body)}
    <table width="100%" cellpadding="0" cellspacing="0"
           style="border:1px solid #e4e4e7;border-radius:8px;overflow:hidden;margin:20px 0;">
      ${slotRow}
      <tr>
        <td style="padding:8px 12px;font-size:13px;color:#71717a;border-bottom:1px solid #f4f4f5;width:140px;">${isFr ? 'Consultant' : 'Consultant'}</td>
        <td style="padding:8px 12px;font-size:13px;color:#09090b;border-bottom:1px solid #f4f4f5;font-weight:500;">${mentorName}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;font-size:13px;color:#71717a;width:140px;">${isFr ? 'Référence' : 'Reference'}</td>
        <td style="padding:8px 12px;font-size:13px;color:#09090b;font-weight:500;">${reference.slice(0, 8).toUpperCase()}</td>
      </tr>
    </table>
    ${p(`<span style="color:#71717a;font-size:13px;">${isFr ? 'Statut : Demande reçue' : 'Status: Request received'}</span>`)}
  `);
}

/* ── New: rejection email ── */

interface ConsultRejectedParams {
  clientName:  string;
  mentorName:  string;
  adminNote:   string | null;
  lang:        'en' | 'fr';
}

export function consultationRejectedEmailHtml(params: ConsultRejectedParams): string {
  const { clientName, mentorName, adminNote, lang } = params;
  const isFr = lang === 'fr';

  const greeting = isFr ? `Bonjour ${clientName},` : `Hello ${clientName},`;
  const title    = isFr ? 'Demande de consultation refusée' : 'Consultation request declined';
  const body     = isFr
    ? `Nous regrettons de vous informer que votre demande de consultation avec <strong>${mentorName}</strong> n'a pas pu être acceptée pour le moment.`
    : `We regret to inform you that your consultation request with <strong>${mentorName}</strong> could not be accepted at this time.`;
  const noteRow = adminNote
    ? `<tr>
        <td style="padding:8px 12px;font-size:13px;color:#71717a;width:140px;">${isFr ? 'Motif' : 'Reason'}</td>
        <td style="padding:8px 12px;font-size:13px;color:#09090b;">${adminNote.replace(/</g, '&lt;')}</td>
       </tr>`
    : '';

  return layout(`
    ${h1(title)}
    ${p(greeting)}
    ${p(body)}
    ${noteRow ? `<table width="100%" cellpadding="0" cellspacing="0"
      style="border:1px solid #e4e4e7;border-radius:8px;overflow:hidden;margin:20px 0;">${noteRow}</table>` : ''}
    ${p(`<span style="color:#71717a;font-size:13px;">${isFr ? 'Vous pouvez soumettre une nouvelle demande à tout moment.' : 'You may submit a new request at any time.'}</span>`)}
  `);
}

/* ── New: admin notification of new consultation ── */

interface AdminConsultNotifParams {
  userName:         string;
  userEmail:        string;
  userPhone:        string;
  mentorName:       string;
  message:          string;
  bookingId:        string;
  consultationDate: string | null | undefined;
  consultationTime: string | null | undefined;
  durationMinutes:  number | null | undefined;
}

export function adminConsultationNotificationHtml(params: AdminConsultNotifParams): string {
  const { userName, userEmail, userPhone, mentorName, message, bookingId, consultationDate, consultationTime, durationMinutes } = params;

  const slotRow = (consultationDate && consultationTime)
    ? `<tr>
        <td style="padding:8px 12px;font-size:13px;color:#71717a;border-bottom:1px solid #f4f4f5;width:140px;">Créneau</td>
        <td style="padding:8px 12px;font-size:13px;color:#09090b;border-bottom:1px solid #f4f4f5;font-weight:500;">${consultationDate} ${consultationTime}${durationMinutes ? ` · ${durationMinutes} min` : ''}</td>
      </tr>`
    : '';

  return layout(`
    ${h1('Nouvelle demande de consultation')}
    ${p(`<strong>${userName}</strong> a soumis une demande de consultation avec <strong>${mentorName}</strong>.`)}
    <table width="100%" cellpadding="0" cellspacing="0"
           style="border:1px solid #e4e4e7;border-radius:8px;overflow:hidden;margin:20px 0;">
      <tr>
        <td style="padding:8px 12px;font-size:13px;color:#71717a;border-bottom:1px solid #f4f4f5;width:140px;">Nom</td>
        <td style="padding:8px 12px;font-size:13px;color:#09090b;border-bottom:1px solid #f4f4f5;font-weight:500;">${userName}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;font-size:13px;color:#71717a;border-bottom:1px solid #f4f4f5;width:140px;">Email</td>
        <td style="padding:8px 12px;font-size:13px;color:#09090b;border-bottom:1px solid #f4f4f5;">${userEmail}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;font-size:13px;color:#71717a;border-bottom:1px solid #f4f4f5;width:140px;">Téléphone</td>
        <td style="padding:8px 12px;font-size:13px;color:#09090b;border-bottom:1px solid #f4f4f5;">${userPhone}</td>
      </tr>
      ${slotRow}
      <tr>
        <td style="padding:8px 12px;font-size:13px;color:#71717a;width:140px;">Réf.</td>
        <td style="padding:8px 12px;font-size:13px;color:#09090b;">${bookingId.slice(0, 8).toUpperCase()}</td>
      </tr>
    </table>
    <div style="background:#f4f4f5;border-radius:8px;padding:16px;margin:16px 0;">
      <p style="margin:0;font-size:13px;color:#3f3f46;line-height:1.7;">${message.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>
    </div>
  `);
}

/* ── Admin: new paid order (space booking / program / event) ── */

export interface AdminOrderNotifParams {
  orderKind:    'SPACE' | 'PROGRAM' | 'EVENT';
  customerName: string;
  customerEmail: string;
  itemName:     string;
  vendorName:   string;
  amount:       number;
  reference:    string;
  paymentMethod: string;
}

export function adminOrderNotificationHtml(params: AdminOrderNotifParams): string {
  const { orderKind, customerName, customerEmail, itemName, vendorName, amount, reference, paymentMethod } = params;
  const kindLabel = orderKind === 'SPACE' ? 'Réservation espace' : orderKind === 'PROGRAM' ? 'Candidature programme' : 'Inscription événement';
  const fmtAmt = amount === 0 ? 'Gratuit' : `${amount.toLocaleString('fr-DZ')} DZD`;

  return layout(`
    ${h1(`[Admin] Nouvelle commande — ${kindLabel}`)}
    ${p(`Un nouveau paiement a été enregistré sur la plateforme.`)}
    <table width="100%" cellpadding="0" cellspacing="0"
           style="border:1px solid #e4e4e7;border-radius:8px;overflow:hidden;margin:20px 0;">
      <tr style="background:#f9fafb;">
        <td style="padding:10px 16px;font-size:13px;color:#71717a;font-weight:600;width:160px;border-bottom:1px solid #e4e4e7;">Type</td>
        <td style="padding:10px 16px;font-size:13px;color:#09090b;border-bottom:1px solid #e4e4e7;">${kindLabel}</td>
      </tr>
      <tr>
        <td style="padding:10px 16px;font-size:13px;color:#71717a;font-weight:600;border-bottom:1px solid #e4e4e7;">Client</td>
        <td style="padding:10px 16px;font-size:13px;color:#09090b;border-bottom:1px solid #e4e4e7;">${customerName} &lt;${customerEmail}&gt;</td>
      </tr>
      <tr style="background:#f9fafb;">
        <td style="padding:10px 16px;font-size:13px;color:#71717a;font-weight:600;border-bottom:1px solid #e4e4e7;">Prestation</td>
        <td style="padding:10px 16px;font-size:13px;color:#09090b;border-bottom:1px solid #e4e4e7;">${itemName}</td>
      </tr>
      <tr>
        <td style="padding:10px 16px;font-size:13px;color:#71717a;font-weight:600;border-bottom:1px solid #e4e4e7;">Fournisseur</td>
        <td style="padding:10px 16px;font-size:13px;color:#09090b;border-bottom:1px solid #e4e4e7;">${vendorName}</td>
      </tr>
      <tr style="background:#f9fafb;">
        <td style="padding:10px 16px;font-size:13px;color:#71717a;font-weight:600;border-bottom:1px solid #e4e4e7;">Paiement</td>
        <td style="padding:10px 16px;font-size:13px;color:#09090b;border-bottom:1px solid #e4e4e7;">${paymentMethod}</td>
      </tr>
      <tr style="background:#f4fdf7;">
        <td style="padding:12px 16px;font-size:14px;color:#166534;font-weight:700;border-top:1px solid #e4e4e7;">Montant</td>
        <td style="padding:12px 16px;font-size:16px;color:#166534;font-weight:700;border-top:1px solid #e4e4e7;">${fmtAmt}</td>
      </tr>
    </table>
    ${p(`<span style="color:#71717a;font-size:12px;">Référence : <code style="background:#f4f4f5;padding:2px 6px;border-radius:4px;font-family:monospace;">${reference.slice(0, 8).toUpperCase()}</code></span>`)}
  `);
}

/* ── Admin: new incubator account ── */

export interface AdminIncubatorNotifParams {
  fullName:  string;
  email:     string;
  phone?:    string;
  userId:    string;
  createdAt: string;
  /** Incubator / organisation name, if distinct from the contact's full name. */
  incubatorName?: string;
  website?:  string | null;
  instagram?: string | null;
  /** Admin review link (incubators manager). */
  reviewUrl?: string;
}

function notifRow(label: string, value: string, striped: boolean): string {
  return `<tr${striped ? ' style="background:#f9fafb;"' : ''}>
    <td style="padding:10px 16px;font-size:13px;color:#71717a;font-weight:600;width:140px;border-bottom:1px solid #e4e4e7;">${label}</td>
    <td style="padding:10px 16px;font-size:13px;color:#09090b;border-bottom:1px solid #e4e4e7;">${value}</td>
  </tr>`;
}

function linkCell(raw: string): string {
  const href = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return `<a href="${href}" style="color:#166534;">${raw}</a>`;
}

export function adminIncubatorNotificationHtml(params: AdminIncubatorNotifParams): string {
  const { fullName, email, phone, userId, createdAt, incubatorName, website, instagram, reviewUrl } = params;
  const fmtDate = (iso: string) => {
    try { return new Date(iso).toLocaleString('fr-DZ', { dateStyle: 'long', timeStyle: 'short' }); }
    catch { return iso; }
  };

  const rows = [
    incubatorName ? notifRow('Incubateur', incubatorName, true) : '',
    notifRow('Contact', fullName, !incubatorName),
    notifRow('Email', linkCell(`mailto:${email}`.replace('mailto:', '')), true),
    phone ? notifRow('Téléphone', phone, false) : '',
    website ? notifRow('Site web', linkCell(website), true) : '',
    instagram ? notifRow('Instagram', linkCell(instagram), false) : '',
    notifRow('Inscrit le', fmtDate(createdAt), true),
    notifRow('ID', `<span style="font-family:monospace;">${userId}</span>`, false),
  ].join('');

  return layout(`
    ${h1('[Admin] Nouvel incubateur inscrit — révision requise')}
    ${p(`Un nouveau compte incubateur vient d'être créé et vérifié. Merci de le passer en revue.`)}
    <table width="100%" cellpadding="0" cellspacing="0"
           style="border:1px solid #e4e4e7;border-radius:8px;overflow:hidden;margin:20px 0;">
      ${rows}
    </table>
    ${reviewUrl ? button(reviewUrl, 'Réviser dans le tableau de bord') : p('<span style="color:#71717a;font-size:12px;">Accédez au tableau de bord admin pour gérer ce compte.</span>')}
  `);
}

/* ── Admin: new investor account ── */

export interface AdminInvestorNotifParams {
  fullName:  string;
  email:     string;
  phone?:    string;
  userId:    string;
  createdAt: string;
  linkedin?: string | null;
  reviewUrl?: string;
}

export function adminInvestorNotificationHtml(params: AdminInvestorNotifParams): string {
  const { fullName, email, phone, userId, createdAt, linkedin, reviewUrl } = params;
  const fmtDate = (iso: string) => {
    try { return new Date(iso).toLocaleString('fr-DZ', { dateStyle: 'long', timeStyle: 'short' }); }
    catch { return iso; }
  };

  const rows = [
    notifRow('Nom', fullName, true),
    notifRow('Email', email, false),
    phone ? notifRow('Téléphone', phone, true) : '',
    linkedin ? notifRow('LinkedIn', linkCell(linkedin), false) : '',
    notifRow('Inscrit le', fmtDate(createdAt), true),
    notifRow('ID', `<span style="font-family:monospace;">${userId}</span>`, false),
  ].join('');

  return layout(`
    ${h1('[Admin] Nouvel investisseur inscrit — révision requise')}
    ${p(`Un nouveau compte investisseur vient d'être créé et vérifié. Merci de le passer en revue.`)}
    <table width="100%" cellpadding="0" cellspacing="0"
           style="border:1px solid #e4e4e7;border-radius:8px;overflow:hidden;margin:20px 0;">
      ${rows}
    </table>
    ${reviewUrl ? button(reviewUrl, 'Réviser dans le tableau de bord') : p('<span style="color:#71717a;font-size:12px;">Accédez au tableau de bord admin pour gérer ce compte.</span>')}
  `);
}

/* ── Consultant (mentor) notification — session confirmed by admin ── */

export interface MentorSessionConfirmedParams {
  mentorName:      string;
  clientName:      string;
  clientEmail:     string;
  clientPhone:     string;
  scheduledAt:     string | null;
  durationMinutes: number | null | undefined;
  meetLink:        string | null | undefined;
  isOffline:       boolean | undefined;
  adminNote:       string | null | undefined;
  reference:       string;
}

export function mentorSessionConfirmedEmailHtml(params: MentorSessionConfirmedParams): string {
  const { mentorName, clientName, clientEmail, clientPhone, scheduledAt, durationMinutes, meetLink, isOffline, adminNote, reference } = params;

  const fmtDt = (iso: string) =>
    new Date(iso).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' });

  const schedRow = scheduledAt
    ? `<tr style="background:#f0fdf4;">
        <td style="padding:10px 16px;font-size:13px;color:#166534;font-weight:700;width:160px;border-bottom:1px solid #e4e4e7;">Session date</td>
        <td style="padding:10px 16px;font-size:14px;color:#15803d;font-weight:700;border-bottom:1px solid #e4e4e7;">${fmtDt(scheduledAt)}</td>
      </tr>`
    : '';

  const durRow = durationMinutes
    ? `<tr>
        <td style="padding:10px 16px;font-size:13px;color:#71717a;font-weight:600;border-bottom:1px solid #e4e4e7;">Duration</td>
        <td style="padding:10px 16px;font-size:13px;color:#09090b;border-bottom:1px solid #e4e4e7;">${durationMinutes} min</td>
      </tr>`
    : '';

  const formatRow = meetLink
    ? `<tr>
        <td style="padding:10px 16px;font-size:13px;color:#71717a;font-weight:600;border-bottom:1px solid #e4e4e7;">Meeting link</td>
        <td style="padding:10px 16px;font-size:13px;border-bottom:1px solid #e4e4e7;">
          <a href="${meetLink}" style="color:#166534;word-break:break-all;">${meetLink}</a>
        </td>
      </tr>`
    : isOffline
    ? `<tr>
        <td style="padding:10px 16px;font-size:13px;color:#71717a;font-weight:600;border-bottom:1px solid #e4e4e7;">Format</td>
        <td style="padding:10px 16px;font-size:13px;color:#09090b;border-bottom:1px solid #e4e4e7;">In-person</td>
      </tr>`
    : '';

  const joinBlock = meetLink
    ? `<div style="margin:24px 0;text-align:center;">
        ${button(meetLink, '📹 Join the session')}
        <p style="margin:10px 0 0;font-size:11px;color:#71717a;word-break:break-all;">${meetLink}</p>
      </div>`
    : '';

  const noteBlock = adminNote
    ? `<div style="background:#fefce8;border:1px solid #fef08a;border-radius:8px;padding:14px 18px;margin:20px 0;">
        <p style="margin:0;font-size:13px;color:#713f12;"><strong>Note:</strong> ${adminNote.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>
      </div>`
    : '';

  return layout(`
    ${h1('Consultation session confirmed ✅')}
    ${p(`Hi <strong>${mentorName}</strong>, a consultation session with a client has been approved and is now confirmed.`)}
    <table width="100%" cellpadding="0" cellspacing="0"
           style="border:1px solid #e4e4e7;border-radius:8px;overflow:hidden;margin:20px 0;">
      <tr style="background:#f9fafb;">
        <td style="padding:10px 16px;font-size:13px;color:#71717a;font-weight:600;width:160px;border-bottom:1px solid #e4e4e7;">Client name</td>
        <td style="padding:10px 16px;font-size:13px;color:#09090b;border-bottom:1px solid #e4e4e7;">${clientName}</td>
      </tr>
      <tr>
        <td style="padding:10px 16px;font-size:13px;color:#71717a;font-weight:600;border-bottom:1px solid #e4e4e7;">Client email</td>
        <td style="padding:10px 16px;font-size:13px;color:#09090b;border-bottom:1px solid #e4e4e7;">
          <a href="mailto:${clientEmail}" style="color:#166534;">${clientEmail}</a>
        </td>
      </tr>
      <tr style="background:#f9fafb;">
        <td style="padding:10px 16px;font-size:13px;color:#71717a;font-weight:600;border-bottom:1px solid #e4e4e7;">Client phone</td>
        <td style="padding:10px 16px;font-size:13px;color:#09090b;border-bottom:1px solid #e4e4e7;">${clientPhone}</td>
      </tr>
      ${schedRow}
      ${durRow}
      ${formatRow}
      <tr style="background:#f9fafb;">
        <td style="padding:10px 16px;font-size:13px;color:#71717a;font-weight:600;">Reference</td>
        <td style="padding:10px 16px;font-size:13px;color:#09090b;font-family:monospace;">${reference.slice(0, 8).toUpperCase()}</td>
      </tr>
    </table>
    ${joinBlock}
    ${noteBlock}
    ${p('<span style="color:#71717a;font-size:13px;">Please be ready 5 minutes before the session starts. The client has received the same meeting details.</span>')}
  `);
}

/* ─────────────────────────── Network Pass / Credits ──────────────────── */

export interface CreditLowWarningEmailParams {
  fullName: string;
  email: string;
  creditsRemaining: number;
  tier: 'BUILDER' | 'FOUNDER';
  resetDate: Date;
  upgradeUrl: string;
}

export function creditLowWarningEmailHtml(params: CreditLowWarningEmailParams): string {
  const { fullName, creditsRemaining, tier, resetDate, upgradeUrl } = params;
  const fmtDate = (d: Date) => {
    try { return d.toLocaleDateString('en-DZ', { dateStyle: 'long' }); }
    catch { return d.toISOString().slice(0, 10); }
  };
  const tierLabel = tier === 'FOUNDER' ? 'Founder' : 'Builder';
  const upgradeNote = tier === 'BUILDER'
    ? `<p style="margin:16px 0;font-size:15px;color:#374151;">Upgrade to <strong>Founder</strong> to get <strong>10 credits</strong> every month.</p>`
    : '';

  return layout(`
    ${h1('Your network credits are running low')}
    ${p(`Hi <strong>${fullName}</strong>, you only have <strong>${creditsRemaining} network pass credit${creditsRemaining !== 1 ? 's' : ''}</strong> left this month as a ${tierLabel} member.`)}
    <table width="100%" cellpadding="0" cellspacing="0"
           style="border:1px solid #fde68a;border-radius:8px;overflow:hidden;margin:20px 0;background:#fffbeb;">
      <tr>
        <td style="padding:16px 20px;font-size:14px;color:#92400e;">
          ⚡ Your credits reset on <strong>${fmtDate(resetDate)}</strong>. Use them before they expire!
        </td>
      </tr>
    </table>
    ${upgradeNote}
    ${upgradeNote ? `<p style="margin:0 0 16px;"><a href="${upgradeUrl}" style="display:inline-block;padding:12px 24px;background:#16a34a;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">Upgrade to Founder</a></p>` : ''}
    ${p('<span style="color:#71717a;font-size:13px;">Network Pass credits expire at the end of the month and do not carry over.</span>')}
  `);
}

export interface CreditExpiryReminderEmailParams {
  fullName: string;
  email: string;
  creditsRemaining: number;
  tier: 'BUILDER' | 'FOUNDER';
  spacesUrl: string;
}

export function creditExpiryReminderEmailHtml(params: CreditExpiryReminderEmailParams): string {
  const { fullName, creditsRemaining, tier, spacesUrl } = params;
  const tierLabel = tier === 'FOUNDER' ? 'Founder' : 'Builder';

  return layout(`
    ${h1('Last day to use your network credits!')}
    ${p(`Hi <strong>${fullName}</strong>, today is the <strong>last day of the month</strong> and you still have <strong>${creditsRemaining} credit${creditsRemaining !== 1 ? 's' : ''}</strong> remaining as a ${tierLabel} member.`)}
    <table width="100%" cellpadding="0" cellspacing="0"
           style="border:1px solid #fca5a5;border-radius:8px;overflow:hidden;margin:20px 0;background:#fef2f2;">
      <tr>
        <td style="padding:16px 20px;font-size:14px;color:#991b1b;">
          🕐 Unused credits expire at midnight UTC tonight and <strong>cannot be carried over</strong>.
        </td>
      </tr>
    </table>
    ${p('Book a coworking space or office at a partner location today to make the most of your membership.')}
    <p style="margin:0 0 16px;"><a href="${spacesUrl}" style="display:inline-block;padding:12px 24px;background:#16a34a;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">Find a Partner Space</a></p>
    ${p('<span style="color:#71717a;font-size:13px;">Your credits will reset tomorrow with a fresh allowance for the new month.</span>')}
  `);
}

export interface MonthlyCreditsResetEmailParams {
  fullName: string;
  email: string;
  newCredits: number;
  tier: 'BUILDER' | 'FOUNDER';
  spacesUrl: string;
}

export function monthlyCreditsResetEmailHtml(params: MonthlyCreditsResetEmailParams): string {
  const { fullName, newCredits, tier, spacesUrl } = params;
  const tierLabel = tier === 'FOUNDER' ? 'Founder' : 'Builder';

  return layout(`
    ${h1('Your network credits have been refreshed!')}
    ${p(`Hi <strong>${fullName}</strong>, your monthly network pass credits have been reset. You now have <strong>${newCredits} credit${newCredits !== 1 ? 's' : ''}</strong> available as a ${tierLabel} member.`)}
    <table width="100%" cellpadding="0" cellspacing="0"
           style="border:1px solid #bbf7d0;border-radius:8px;overflow:hidden;margin:20px 0;background:#f0fdf4;">
      <tr>
        <td style="padding:16px 20px;font-size:14px;color:#166534;">
          ✅ <strong>${newCredits}</strong> network pass credit${newCredits !== 1 ? 's' : ''} — valid until the last day of this month.
        </td>
      </tr>
    </table>
    ${p('Use your credits to book coworking spaces and offices at any Metwork partner location.')}
    <p style="margin:0 0 16px;"><a href="${spacesUrl}" style="display:inline-block;padding:12px 24px;background:#16a34a;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">Browse Partner Spaces</a></p>
  `);
}

/* ─────────────── Network Pass Check-in (booking confirmation) ────────── */

export interface NetworkPassCheckInEmailParams {
  customerName: string;
  bookingId: string;
  spaceName: string;
  city: string;
  bookingDate: string;     // ISO datetime
  startsAt: string;        // ISO datetime
  endsAt: string;          // ISO datetime
  /** Plaintext code, e.g. "MNP-2026-00145" — shown to user only here. */
  code: string;
  /** "data:image/png;base64,…" — base64-encoded QR PNG. */
  qrCodeDataUrl: string;
  /** ISO datetime — 23:59:59 UTC on the booking day. */
  expiresAt: string;
}

/**
 * Sent to the user when a Network Pass booking is confirmed. Contains the
 * QR code + plaintext check-in code (shown only ONCE — never retrievable
 * from the DB).
 */
export function networkPassCheckInEmailHtml(opts: NetworkPassCheckInEmailParams): string {
  const fmtDate = (iso: string) => {
    try { return new Date(iso).toLocaleDateString('en-US', { dateStyle: 'long' }); }
    catch { return iso.slice(0, 10); }
  };
  const fmtTime = (iso: string) => {
    try { return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }); }
    catch { return iso; }
  };
  const fmtExpiry = (iso: string) => {
    try { return new Date(iso).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' }); }
    catch { return iso; }
  };

  return layout(`
    ${h1('Your Network Pass is ready')}
    ${p(`Hi <strong>${opts.customerName}</strong>, your coworking session is booked. Show this QR or read out the code at reception.`)}
    <table width="100%" cellpadding="0" cellspacing="0"
           style="border:2px solid #16a34a;border-radius:12px;overflow:hidden;margin:20px 0;background:#f0fdf4;">
      <tr>
        <td style="padding:24px;text-align:center;">
          <div style="font-size:13px;color:#166534;font-weight:600;letter-spacing:0.5px;margin-bottom:12px;">🎫 NETWORK PASS CHECK-IN</div>
          <img src="${opts.qrCodeDataUrl}" width="220" height="220" alt="Network Pass QR Code" style="border-radius:8px;border:1px solid #bbf7d0;background:#ffffff;" />
          <div style="margin-top:16px;font-size:13px;color:#166534;">Your Check-in Code</div>
          <div style="margin-top:4px;font-family:'SF Mono',Menlo,Consolas,monospace;font-size:24px;color:#09090b;font-weight:700;letter-spacing:1px;">${opts.code}</div>
        </td>
      </tr>
    </table>
    <table width="100%" cellpadding="0" cellspacing="0"
           style="border:1px solid #e4e4e7;border-radius:8px;overflow:hidden;margin:20px 0;">
      <tr style="background:#f9fafb;">
        <td style="padding:12px 16px;font-size:13px;color:#71717a;font-weight:600;width:40%;">Space</td>
        <td style="padding:12px 16px;font-size:14px;color:#09090b;font-weight:500;">${opts.spaceName}</td>
      </tr>
      <tr>
        <td style="padding:12px 16px;font-size:13px;color:#71717a;font-weight:600;border-top:1px solid #e4e4e7;">City</td>
        <td style="padding:12px 16px;font-size:14px;color:#09090b;border-top:1px solid #e4e4e7;">${opts.city}</td>
      </tr>
      <tr style="background:#f9fafb;">
        <td style="padding:12px 16px;font-size:13px;color:#71717a;font-weight:600;border-top:1px solid #e4e4e7;">Date</td>
        <td style="padding:12px 16px;font-size:14px;color:#09090b;border-top:1px solid #e4e4e7;">${fmtDate(opts.bookingDate)}</td>
      </tr>
      <tr>
        <td style="padding:12px 16px;font-size:13px;color:#71717a;font-weight:600;border-top:1px solid #e4e4e7;">Time</td>
        <td style="padding:12px 16px;font-size:14px;color:#09090b;border-top:1px solid #e4e4e7;">${fmtTime(opts.startsAt)} – ${fmtTime(opts.endsAt)}</td>
      </tr>
    </table>
    <table width="100%" cellpadding="0" cellspacing="0"
           style="border:1px solid #fde68a;border-radius:8px;overflow:hidden;margin:20px 0;background:#fffbeb;">
      <tr>
        <td style="padding:16px 20px;font-size:14px;color:#92400e;">
          ⏰ <strong>Expires:</strong> ${fmtExpiry(opts.expiresAt)} — single use only.
        </td>
      </tr>
    </table>
    ${p('<span style="color:#71717a;font-size:13px;">Lost the code? Visit your bookings page in the Metwork dashboard to view it again.</span>')}
  `);
}

// ─────────────────────────────────────────────────────────────────────────────
// Partner promo code invite email
// ─────────────────────────────────────────────────────────────────────────────

export interface PartnerPromoCodeEmailParams {
  /** Recipient's name or email address (used in the greeting). */
  recipientName: string;
  /** Name of the partner space issuing the code. */
  partnerName: string;
  /** The plaintext promo code — e.g. "PPT-ORAN-2026-X7K3M2". */
  promoCode: string;
  /** 'BUILDER' or 'FOUNDER' — shown to the user. */
  membershipTier: 'BUILDER' | 'FOUNDER';
  /** Discount percentage (integer 1–99). */
  discountPercentage: number;
  /** Expiry date in ISO YYYY-MM-DD format. */
  validUntil: string;
  /** Redemption URL — links to the membership checkout page. */
  redeemUrl: string;
}

export function partnerPromoCodeEmailHtml(params: PartnerPromoCodeEmailParams): string {
  const {
    recipientName,
    partnerName,
    promoCode,
    membershipTier,
    discountPercentage,
    validUntil,
    redeemUrl,
  } = params;

  const tierLabel = membershipTier === 'FOUNDER' ? 'Founder' : 'Builder';
  const expiryFormatted = new Date(validUntil).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });

  return layout(`
    ${h1(`You have a ${discountPercentage}% membership discount! 🎉`)}
    ${p(`Hi <strong>${recipientName}</strong>, <strong>${partnerName}</strong> has invited you to join Metwork&apos;s <strong>${tierLabel}</strong> membership tier at a ${discountPercentage}% discount.`)}
    ${p('Use the exclusive code below when you upgrade your membership:')}
    <div style="text-align:center;margin:32px 0;">
      <span style="display:inline-block;padding:16px 36px;background:#f0fdf4;border:2px dashed #166534;border-radius:12px;font-size:28px;font-weight:700;letter-spacing:6px;color:#166534;font-family:monospace;">${promoCode}</span>
    </div>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e4e4e7;border-radius:8px;overflow:hidden;margin:0 0 24px;">
      <tr style="background:#f9fafb;">
        <td colspan="2" style="padding:12px 16px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#71717a;border-bottom:1px solid #e4e4e7;">
          Discount details
        </td>
      </tr>
      <tr>
        <td style="padding:10px 16px;font-size:13px;color:#71717a;border-bottom:1px solid #f4f4f5;width:140px;">Membership tier</td>
        <td style="padding:10px 16px;font-size:13px;color:#09090b;border-bottom:1px solid #f4f4f5;font-weight:600;">${tierLabel}</td>
      </tr>
      <tr>
        <td style="padding:10px 16px;font-size:13px;color:#71717a;border-bottom:1px solid #f4f4f5;">Discount</td>
        <td style="padding:10px 16px;font-size:13px;color:#166534;border-bottom:1px solid #f4f4f5;font-weight:600;">${discountPercentage}% off</td>
      </tr>
      <tr>
        <td style="padding:10px 16px;font-size:13px;color:#71717a;">Valid until</td>
        <td style="padding:10px 16px;font-size:13px;color:#09090b;font-weight:600;">${expiryFormatted}</td>
      </tr>
    </table>
    ${button(redeemUrl, 'Redeem your discount')}
    ${p('<span style="color:#71717a;font-size:13px;">This code is single-use and cannot be transferred. Once redeemed your discounted membership will be activated immediately for one year.</span>')}
    ${p(`<span style="color:#71717a;font-size:13px;">If you did not expect this email or have questions, please contact your space administrator at <strong>${partnerName}</strong>.</span>`)}
  `);
}

// ─────────────────────────────────────────────────────────────────────────────
// Membership welcome email (tier-specific)
// ─────────────────────────────────────────────────────────────────────────────

export interface MembershipWelcomeEmailParams {
  /** Recipient's full name. */
  fullName: string;
  /** 'BUILDER' or 'FOUNDER'. */
  membershipTier: 'BUILDER' | 'FOUNDER';
  /** Monthly credits allocated (3 for Builder, 10 for Founder). */
  monthlyCredits: number;
  /** ISO expiry date. */
  expiresAt: string;
  /** URL to the membership dashboard. */
  dashboardUrl: string;
}

/**
 * Tier-themed welcome email sent when a user activates a Builder or Founder
 * membership (direct purchase or via a partner promo code).
 *
 * Subject line should be set by the caller:
 *   Builder → "🏆 Welcome to Metwork Builder membership!"
 *   Founder → "👑 Welcome to Metwork Founder membership!"
 */
export function membershipWelcomeEmailHtml(params: MembershipWelcomeEmailParams): string {
  const { fullName, membershipTier, monthlyCredits, expiresAt, dashboardUrl } = params;

  const isFounder = membershipTier === 'FOUNDER';
  const tierLabel = isFounder ? 'Founder' : 'Builder';
  const tierIcon  = isFounder ? '👑' : '🏆';

  // Tier-specific accent colors (inline — email clients don't support CSS vars)
  const accentColor    = isFounder ? '#9D9B99' : '#D4AF37';
  const accentBg       = isFounder ? '#F5F4F2' : '#FAF6F0';
  const accentBorder   = isFounder ? '#E5E4E2' : '#E8D9B5';
  const accentText     = isFounder ? '#4A4845' : '#6B5218';

  const expiryFormatted = new Date(expiresAt).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  });

  const benefits = isFounder
    ? [
        `${monthlyCredits} coworking sessions / month`,
        'Access to all 30+ partner spaces',
        'Featured startup listing',
        'Priority mentor sessions (3 / month)',
        'Investor meeting requests',
        'Dedicated support',
      ]
    : [
        `${monthlyCredits} coworking sessions / month`,
        'Access to all partner spaces',
        'Book spaces & programs',
        'Priority mentor session (1 / month)',
        'Events at discounted rate',
      ];

  const benefitRows = benefits
    .map(
      (b) =>
        `<tr><td style="padding:6px 0;font-size:14px;color:#3f3f46;line-height:1.5;">
          <span style="color:${accentColor};margin-right:8px;">✓</span>${b}
        </td></tr>`,
    )
    .join('');

  return layout(`
    ${h1(`${tierIcon} Welcome to Metwork ${tierLabel}!`)}
    ${p(`Hi <strong>${fullName}</strong> — your <strong>${tierLabel}</strong> membership is now active. Here's everything you have access to:`)}
    <table width="100%" cellpadding="0" cellspacing="0"
           style="border:1.5px solid ${accentBorder};border-radius:12px;overflow:hidden;margin:20px 0;background:${accentBg};">
      <tr>
        <td style="padding:16px 20px;border-bottom:1px solid ${accentBorder};">
          <span style="font-size:20px;font-weight:700;color:${accentColor};">${tierIcon} ${tierLabel} Member</span>
          <p style="margin:4px 0 0;font-size:13px;color:${accentText};">Valid until ${expiryFormatted}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:16px 20px;">
          <p style="margin:0 0 10px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:${accentText};">
            Your benefits
          </p>
          <table width="100%" cellpadding="0" cellspacing="0">
            ${benefitRows}
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:12px 20px;background:${accentBorder}30;border-top:1px solid ${accentBorder};">
          <p style="margin:0;font-size:13px;color:${accentText};">
            <strong>${monthlyCredits} network credits</strong> reset on the 1st of each month.
          </p>
        </td>
      </tr>
    </table>
    ${button(dashboardUrl, 'Go to your dashboard')}
    ${p('<span style="color:#71717a;font-size:13px;">Credits are non-transferable and do not roll over. Questions? Reply to this email.</span>')}
  `);
}

/* ─────────── REQUEST-mode space reservations (approve-then-pay) ───────────
 * Four templates for the Airbnb-style "Request to Book" flow:
 *   1. bookingRequestReceivedEmailHtml   — client: request sent, host reviewing.
 *   2. incubatorBookingRequestEmailHtml  — incubator: new request to approve.
 *   3. bookingApprovedPayEmailHtml       — client: approved, pay via link.
 *   4. bookingPaidIncubatorEmailHtml     — incubator: booking paid & confirmed.
 * All tri-lingual (en/fr/ar) with RTL for Arabic, same conventions as the
 * incubator-approval template above.
 */

/** Localized date-time for reservation emails ("9 juil. 2026, 14:00"). */
function fmtBookingDate(iso: string, lang: EmailLang): string {
  const locale = lang === 'ar' ? 'ar-DZ' : lang === 'en' ? 'en-GB' : 'fr-FR';
  try {
    return new Date(iso).toLocaleString(locale, {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
    });
  } catch {
    return iso;
  }
}

function fmtDzd(amount: number): string {
  return `${amount.toLocaleString('fr-DZ')} DZD`;
}

/** Shared key→value details block (space, dates, amount). */
function bookingDetailsTable(rows: Array<[string, string]>): string {
  const tr = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 12px;font-size:13px;color:#71717a;white-space:nowrap;">${k}</td>` +
        `<td style="padding:6px 12px;font-size:13px;color:#09090b;font-weight:600;">${v}</td></tr>`,
    )
    .join('');
  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;background:#f9fafb;border:1px solid #e4e4e7;border-radius:8px;">${tr}</table>`;
}

const RESERVATION_LABELS: Record<EmailLang, { space: string; from: string; to: string; amount: string; client: string }> = {
  en: { space: 'Space', from: 'From', to: 'To', amount: 'Amount', client: 'Client' },
  fr: { space: 'Espace', from: 'Du', to: 'Au', amount: 'Montant', client: 'Client' },
  ar: { space: 'المساحة', from: 'من', to: 'إلى', amount: 'المبلغ', client: 'العميل' },
};

export function bookingRequestReceivedEmailHtml(opts: {
  customerName: string;
  itemName: string;
  vendorName: string;
  startsAt: string;
  endsAt: string;
  totalAmount: number;
  lang?: EmailLang;
}): string {
  const lang = normalizeEmailLang(opts.lang);
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const L = RESERVATION_LABELS[lang];
  const copy = {
    en: {
      heading: 'Request sent — awaiting host approval',
      intro: `Hi ${opts.customerName}, your booking request for <strong>${opts.itemName}</strong> was sent to ${opts.vendorName}. <strong>Nothing has been charged.</strong> You will only pay after the host approves your request.`,
      footer: 'We will email you as soon as the host responds. If the request is not approved, nothing is charged.',
    },
    fr: {
      heading: 'Demande envoyée — en attente d’approbation',
      intro: `Bonjour ${opts.customerName}, votre demande de réservation pour <strong>${opts.itemName}</strong> a été envoyée à ${opts.vendorName}. <strong>Aucun montant n’a été débité.</strong> Vous ne paierez qu’après l’approbation de votre demande.`,
      footer: 'Nous vous écrirons dès que l’hôte aura répondu. Si la demande n’est pas approuvée, rien ne sera débité.',
    },
    ar: {
      heading: 'تم إرسال الطلب — في انتظار موافقة المضيف',
      intro: `مرحباً ${opts.customerName}، تم إرسال طلب حجزك لـ <strong>${opts.itemName}</strong> إلى ${opts.vendorName}. <strong>لم يتم خصم أي مبلغ.</strong> لن تدفع إلا بعد موافقة المضيف على طلبك.`,
      footer: 'سنراسلك فور رد المضيف. إذا لم تتم الموافقة على الطلب، فلن يتم خصم أي مبلغ.',
    },
  }[lang];

  return layout(`
    <div dir="${dir}">
    ${h1(copy.heading)}
    ${p(copy.intro)}
    ${bookingDetailsTable([
      [L.space, opts.itemName],
      [L.from, fmtBookingDate(opts.startsAt, lang)],
      [L.to, fmtBookingDate(opts.endsAt, lang)],
      [L.amount, fmtDzd(opts.totalAmount)],
    ])}
    ${p(`<span style="color:#71717a;font-size:13px;">${copy.footer}</span>`)}
    </div>
  `);
}

export function incubatorBookingRequestEmailHtml(opts: {
  incubatorName: string;
  customerName: string;
  itemName: string;
  startsAt: string;
  endsAt: string;
  totalAmount: number;
  dashboardUrl: string;
  lang?: EmailLang;
}): string {
  const lang = normalizeEmailLang(opts.lang);
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const L = RESERVATION_LABELS[lang];
  const copy = {
    en: {
      heading: 'New booking request awaiting your approval',
      intro: `${opts.customerName} requested to book <strong>${opts.itemName}</strong>. The slot is held for them while you decide — approve to send them a payment link, or decline to release it.`,
      cta: 'Review the request',
    },
    fr: {
      heading: 'Nouvelle demande de réservation à approuver',
      intro: `${opts.customerName} a demandé à réserver <strong>${opts.itemName}</strong>. Le créneau est retenu pendant votre décision — approuvez pour lui envoyer un lien de paiement, ou refusez pour le libérer.`,
      cta: 'Examiner la demande',
    },
    ar: {
      heading: 'طلب حجز جديد في انتظار موافقتك',
      intro: `طلب ${opts.customerName} حجز <strong>${opts.itemName}</strong>. الموعد محجوز مؤقتاً حتى تقرر — وافق لإرسال رابط الدفع، أو ارفض لتحرير الموعد.`,
      cta: 'مراجعة الطلب',
    },
  }[lang];

  return layout(`
    <div dir="${dir}">
    ${h1(copy.heading)}
    ${p(copy.intro)}
    ${bookingDetailsTable([
      [L.client, opts.customerName],
      [L.space, opts.itemName],
      [L.from, fmtBookingDate(opts.startsAt, lang)],
      [L.to, fmtBookingDate(opts.endsAt, lang)],
      [L.amount, fmtDzd(opts.totalAmount)],
    ])}
    ${button(opts.dashboardUrl, copy.cta)}
    </div>
  `);
}

export function bookingApprovedPayEmailHtml(opts: {
  customerName: string;
  itemName: string;
  vendorName: string;
  startsAt: string;
  endsAt: string;
  totalAmount: number;
  payUrl: string;
  expiresAt: string;
  lang?: EmailLang;
}): string {
  const lang = normalizeEmailLang(opts.lang);
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const L = RESERVATION_LABELS[lang];
  const expires = fmtBookingDate(opts.expiresAt, lang);
  const copy = {
    en: {
      heading: 'Your booking is approved — complete payment',
      intro: `Good news ${opts.customerName}! ${opts.vendorName} approved your request for <strong>${opts.itemName}</strong>. Complete the payment to confirm your reservation.`,
      cta: 'Pay now',
      expiry: `This payment link expires on <strong>${expires}</strong>. After that the reservation is released.`,
    },
    fr: {
      heading: 'Réservation approuvée — finalisez le paiement',
      intro: `Bonne nouvelle ${opts.customerName} ! ${opts.vendorName} a approuvé votre demande pour <strong>${opts.itemName}</strong>. Finalisez le paiement pour confirmer votre réservation.`,
      cta: 'Payer maintenant',
      expiry: `Ce lien de paiement expire le <strong>${expires}</strong>. Passé ce délai, la réservation sera libérée.`,
    },
    ar: {
      heading: 'تمت الموافقة على حجزك — أكمل الدفع',
      intro: `خبر سار ${opts.customerName}! وافق ${opts.vendorName} على طلبك لـ <strong>${opts.itemName}</strong>. أكمل الدفع لتأكيد حجزك.`,
      cta: 'ادفع الآن',
      expiry: `تنتهي صلاحية رابط الدفع في <strong>${expires}</strong>. بعد ذلك سيتم تحرير الحجز.`,
    },
  }[lang];

  return layout(`
    <div dir="${dir}">
    ${h1(copy.heading)}
    ${p(copy.intro)}
    ${bookingDetailsTable([
      [L.space, opts.itemName],
      [L.from, fmtBookingDate(opts.startsAt, lang)],
      [L.to, fmtBookingDate(opts.endsAt, lang)],
      [L.amount, fmtDzd(opts.totalAmount)],
    ])}
    ${button(opts.payUrl, copy.cta)}
    ${p(`<span style="color:#71717a;font-size:13px;">${copy.expiry}</span>`)}
    </div>
  `);
}

export function bookingPaidIncubatorEmailHtml(opts: {
  incubatorName: string;
  customerName: string;
  itemName: string;
  startsAt: string;
  endsAt: string;
  totalAmount: number;
  dashboardUrl: string;
  lang?: EmailLang;
}): string {
  const lang = normalizeEmailLang(opts.lang);
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const L = RESERVATION_LABELS[lang];
  const copy = {
    en: {
      heading: 'Booking paid & confirmed',
      intro: `${opts.customerName} completed the payment for <strong>${opts.itemName}</strong>. The booking is now confirmed and your wallet has been credited.`,
      cta: 'View your bookings',
    },
    fr: {
      heading: 'Réservation payée et confirmée',
      intro: `${opts.customerName} a finalisé le paiement pour <strong>${opts.itemName}</strong>. La réservation est confirmée et votre portefeuille a été crédité.`,
      cta: 'Voir vos réservations',
    },
    ar: {
      heading: 'تم دفع الحجز وتأكيده',
      intro: `أكمل ${opts.customerName} دفع <strong>${opts.itemName}</strong>. تم تأكيد الحجز وإضافة المبلغ إلى محفظتك.`,
      cta: 'عرض حجوزاتك',
    },
  }[lang];

  return layout(`
    <div dir="${dir}">
    ${h1(copy.heading)}
    ${p(copy.intro)}
    ${bookingDetailsTable([
      [L.client, opts.customerName],
      [L.space, opts.itemName],
      [L.from, fmtBookingDate(opts.startsAt, lang)],
      [L.to, fmtBookingDate(opts.endsAt, lang)],
      [L.amount, fmtDzd(opts.totalAmount)],
    ])}
    ${button(opts.dashboardUrl, copy.cta)}
    </div>
  `);
}
