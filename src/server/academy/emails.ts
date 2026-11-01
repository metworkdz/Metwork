/**
 * Startup Academy learner emails — en / fr / ar (Arabic renders RTL), same
 * pattern as `notifications/refund-emails.ts`:
 *
 *   CERTIFICATE  — the learner's certificate is ready (PDF attached)
 *   REMINDER     — "keep going": a started course has been idle for a week
 *
 * Every send is awaited by its caller and never throws.
 */
import { button, h1, layout, normalizeEmailLang, p, sendResendEmail, type EmailLang } from '@/server/notifications/email';
import { recordE2eEmail } from '@/server/notifications/e2e-email-sink';

const ORIGIN = 'https://metwork.dz';

function esc(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export type AcademyEmailInput =
  | { kind: 'CERTIFICATE'; to: string; lang?: string | null; name: string; courseTitle: string; number: string; verifyUrl: string; pdf: Buffer | null }
  | { kind: 'REMINDER'; to: string; lang?: string | null; name: string; courseTitle: string; slug: string; done: number; total: number };

interface Copy { subject: string; title: string; body: string[]; cta: { href: string; label: string }; note?: string }

function copyFor(input: AcademyEmailInput, lang: EmailLang): Copy {
  const name = esc(input.name.split(/\s+/)[0] ?? '');
  const course = `<strong>${esc(input.courseTitle)}</strong>`;
  const prefix = lang === 'fr' ? '' : `/${lang}`;
  if (input.kind === 'CERTIFICATE') {
    const num = `<span dir="ltr">${esc(input.number)}</span>`;
    return {
      en: {
        subject: `Your certificate — ${input.courseTitle}`,
        title: 'Congratulations, your certificate is ready',
        body: [`Hello ${name},`, `You completed ${course} and passed its quizzes. Your certificate ${num} is attached to this email.`, 'Anyone can check it is genuine with the QR code printed on it, or the link below.'],
        cta: { href: input.verifyUrl, label: 'View the verification page' },
        note: 'You can download it again at any time from My learning.',
      },
      fr: {
        subject: `Votre certificat — ${input.courseTitle}`,
        title: 'Félicitations, votre certificat est prêt',
        body: [`Bonjour ${name},`, `Vous avez terminé ${course} et réussi ses quiz. Votre certificat ${num} est joint à cet email.`, 'Chacun peut vérifier son authenticité avec le QR code imprimé dessus, ou le lien ci-dessous.'],
        cta: { href: input.verifyUrl, label: 'Voir la page de vérification' },
        note: 'Vous pouvez le télécharger à nouveau à tout moment depuis Mon apprentissage.',
      },
      ar: {
        subject: `شهادتك — ${input.courseTitle}`,
        title: 'تهانينا، شهادتك جاهزة',
        body: [`مرحبًا ${name}،`, `لقد أتممت ${course} ونجحت في اختباراته. شهادتك ${num} مرفقة بهذا البريد.`, 'يمكن لأي شخص التحقق من صحتها عبر رمز QR المطبوع عليها أو الرابط أدناه.'],
        cta: { href: input.verifyUrl, label: 'عرض صفحة التحقق' },
        note: 'يمكنك تنزيلها مجددًا في أي وقت من صفحة تعلّمي.',
      },
    }[lang];
  }
  const href = `${ORIGIN}${prefix}/academy/learn/${encodeURIComponent(input.slug)}`;
  const off = `${ORIGIN}${prefix}/academy/my#reminders`;
  const progress = `${input.done}/${input.total}`;
  return {
    en: {
      subject: `Pick up where you left off — ${input.courseTitle}`,
      title: 'Your course is waiting for you',
      body: [`Hello ${name},`, `You have watched ${progress} lessons of ${course}. A few minutes today is enough to keep going.`],
      cta: { href, label: 'Resume the course' },
      note: `Don't want these reminders? <a href="${off}">Turn them off on My learning</a>.`,
    },
    fr: {
      subject: `Reprenez là où vous vous êtes arrêté — ${input.courseTitle}`,
      title: 'Votre cours vous attend',
      body: [`Bonjour ${name},`, `Vous avez suivi ${progress} leçons de ${course}. Quelques minutes aujourd’hui suffisent pour avancer.`],
      cta: { href, label: 'Reprendre le cours' },
      note: `Vous ne voulez plus de ces rappels ? <a href="${off}">Désactivez-les dans Mon apprentissage</a>.`,
    },
    ar: {
      subject: `واصل من حيث توقفت — ${input.courseTitle}`,
      title: 'دورتك في انتظارك',
      body: [`مرحبًا ${name}،`, `شاهدت ${progress} من دروس ${course}. بضع دقائق اليوم تكفي لمواصلة التقدم.`],
      cta: { href, label: 'استئناف الدورة' },
      note: `لا تريد هذه التذكيرات؟ <a href="${off}">أوقفها من صفحة تعلّمي</a>.`,
    },
  }[lang];
}

export function academyEmailHtml(input: AcademyEmailInput): string {
  const lang = normalizeEmailLang(input.lang);
  const c = copyFor(input, lang);
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  return layout(
    `<div dir="${dir}">
      ${h1(c.title)}
      ${c.body.map((line) => p(line)).join('')}
      ${button(c.cta.href, esc(c.cta.label))}
      ${c.note ? p(`<span style="color:#71717a;font-size:13px;">${c.note}</span>`) : ''}
    </div>`,
    { lang: lang === 'en' ? 'en' : 'fr' },
  );
}

/** Send one Academy email. Never throws. */
export async function sendAcademyEmail(input: AcademyEmailInput): Promise<boolean> {
  const lang = normalizeEmailLang(input.lang);
  recordE2eEmail(`academy-${input.kind.toLowerCase()}`, { to: input.to, lang });
  try {
    const sent = await sendResendEmail({
      to: input.to,
      subject: copyFor(input, lang).subject,
      html: academyEmailHtml(input),
      attachments: input.kind === 'CERTIFICATE' && input.pdf ? [{ filename: `${input.number}.pdf`, content: input.pdf }] : undefined,
    });
    if (!sent) {
      // eslint-disable-next-line no-console
      console.log(`[notify] EMAIL (academy/${input.kind}) → ${input.to}`);
    }
    return sent;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[academy] email failed:', err instanceof Error ? err.message : err);
    return false;
  }
}
