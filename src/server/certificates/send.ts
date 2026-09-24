/**
 * Emailing certificates — for trainings held online, where there is no paper
 * to hand over. Each participant gets their own one-page PDF, in the e-mail
 * version (signature images and stamp printed), in the language they
 * registered in.
 *
 * Sending is batched: a request sends at most SEND_BATCH emails and says how
 * many are left, and the page calls again until none are. One request per
 * thirty people could not otherwise stay inside a serverless time limit, and a
 * batch that fails halfway has already stamped what it sent — asking again
 * never emails anyone twice.
 */
import { db } from '@/server/db/store';
import {
  layout,
  normalizeEmailLang,
  sendResendEmail,
  type EmailLang,
} from '@/server/notifications/email';
import type { OwnerScope } from '@/server/registrations/service';

import {
  certificateFilename,
  certificateVerifyUrl,
  issueCertificates,
  renderIssuedCertificates,
  type IssuedCertificate,
} from './issue';
import { loadCertificateImages } from './render';
import { formatCertificateDates } from './text';

/** Emails per request — comfortably inside a 60-second function. */
export const SEND_BATCH = 20;

/** A claim older than this belongs to a run that died; the email is fair game. */
const CLAIM_TTL_MS = 5 * 60_000;

const COPY: Record<EmailLang, {
  subject: (title: string) => string;
  heading: string;
  greeting: (name: string) => string;
  body: (title: string, organizer: string, dates: string) => string;
  attached: string;
  verify: string;
  number: (n: string) => string;
}> = {
  fr: {
    subject: (t) => `Votre attestation de participation — ${t}`,
    heading: 'Votre attestation de participation',
    greeting: (n) => `Bonjour <strong>${n}</strong>,`,
    body: (t, o, d) => `Merci d’avoir participé à la formation <strong>« ${t} »</strong>, organisée par ${o} ${d}.`,
    attached: 'Vous trouverez votre attestation en pièce jointe, au format PDF.',
    verify: 'Vérifier l’attestation',
    number: (n) => `Attestation N° ${n}`,
  },
  en: {
    subject: (t) => `Your certificate of participation — ${t}`,
    heading: 'Your certificate of participation',
    greeting: (n) => `Hello <strong>${n}</strong>,`,
    body: (t, o, d) => `Thank you for taking part in <strong>“${t}”</strong>, organised by ${o} (${d}).`,
    attached: 'Your certificate is attached to this email as a PDF.',
    verify: 'Verify the certificate',
    number: (n) => `Certificate No. ${n}`,
  },
  ar: {
    subject: (t) => `شهادة المشاركة الخاصة بك — ${t}`,
    heading: 'شهادة المشاركة الخاصة بك',
    greeting: (n) => `مرحباً <strong>${n}</strong>،`,
    body: (t, o, d) => `شكراً لمشاركتك في التكوين <strong>« ${t} »</strong> الذي نظّمه ${o} (${d}).`,
    attached: 'تجد شهادتك مرفقة بهذا البريد بصيغة PDF.',
    verify: 'التحقق من الشهادة',
    number: (n) => `الشهادة رقم ${n}`,
  },
};

/** The training's dates in the email's own language. */
function emailDates(lang: EmailLang, startIso: string, endIso: string): string {
  if (lang === 'fr') return formatCertificateDates(startIso, endIso);
  const fmt = new Intl.DateTimeFormat(lang === 'ar' ? 'ar-DZ' : 'en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Algiers',
  });
  try {
    return fmt.formatRange(new Date(startIso), new Date(endIso));
  } catch {
    return fmt.format(new Date(startIso));
  }
}

function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function certificateEmail(item: IssuedCertificate): { subject: string; html: string } {
  const lang = normalizeEmailLang(item.registration.locale);
  const c = COPY[lang];
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const align = lang === 'ar' ? 'right' : 'left';
  const cert = item.certificate;
  const dates = emailDates(lang, cert.startDate, cert.endDate);
  const verifyUrl = certificateVerifyUrl(cert.verifyToken);

  const html = layout(`
    <div dir="${dir}" style="text-align:${align};">
      <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#09090b;">${c.heading}</h1>
      <p style="margin:0 0 16px;font-size:15px;color:#3f3f46;line-height:1.6;">${c.greeting(esc(item.registration.fullName))}</p>
      <p style="margin:0 0 16px;font-size:15px;color:#3f3f46;line-height:1.6;">
        ${c.body(esc(cert.programTitle), esc(cert.organizer), esc(dates))}
      </p>
      <p style="margin:0 0 20px;font-size:15px;color:#3f3f46;line-height:1.6;">${c.attached}</p>
      <p style="margin:0 0 20px;">
        <a href="${esc(verifyUrl)}" style="display:inline-block;padding:12px 24px;background:#30a735;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">${c.verify}</a>
      </p>
      <p style="margin:0;font-size:12px;color:#71717a;" dir="${dir}">${c.number(esc(cert.number))}</p>
    </div>
  `, { lang: lang === 'en' ? 'en' : 'fr' });

  return { subject: c.subject(cert.programTitle), html };
}

export type SendResult =
  | {
      ok: true;
      sent: number;
      /** Participants whose email could not be sent this time. */
      failed: Array<{ registrationId: string; fullName: string }>;
      /** Still to send — call again. */
      remaining: number;
    }
  | { ok: false; reason: 'NOT_FOUND' | 'NOT_SAVED' | 'NONE' | 'TOO_MANY' };

/**
 * Send certificates by email.
 *
 * `registrationIds` given: send to those, even if already sent (the host
 * asked to resend). Omitted: send to every present participant not yet sent
 * one — and `skip` lists who already failed in this run, so a bad address is
 * not retried in a loop.
 */
export async function sendCertificates(
  programId: string,
  owner: OwnerScope,
  opts: { registrationIds?: string[]; skip?: string[] } = {},
): Promise<SendResult> {
  // An explicit list is a resend: it must fit one request, or calling again
  // for the rest would email the first ones a second time.
  if (opts.registrationIds && opts.registrationIds.length > SEND_BATCH) return { ok: false, reason: 'TOO_MANY' };
  const result = await issueCertificates(programId, owner, opts.registrationIds);
  if (!result.ok) return result;

  const skip = new Set(opts.skip ?? []);
  const pending = result.issued.filter((item) =>
    !skip.has(item.registration.id)
    && (opts.registrationIds ? true : !item.certificate.emailedAt));

  // Claim the batch in one mutation before sending anything, so a second run
  // (another tab) cannot pick the same people. An explicit resend is the host
  // naming someone on purpose, so it claims without asking.
  const candidates = pending.slice(0, SEND_BATCH).map((i) => i.certificate.id);
  const claimedIds = await db.update((d) => {
    const nowMs = Date.now();
    const claimed = new Set<string>();
    for (const c of d.certificates ?? []) {
      if (!candidates.includes(c.id)) continue;
      const claimAlive = c.emailClaimedAt && nowMs - Date.parse(c.emailClaimedAt) < CLAIM_TTL_MS;
      if (!opts.registrationIds && (c.emailedAt || claimAlive)) continue;
      c.emailClaimedAt = new Date(nowMs).toISOString();
      claimed.add(c.id);
    }
    return claimed;
  });
  const batch = pending.filter((i) => claimedIds.has(i.certificate.id));
  if (batch.length === 0) {
    return { ok: true, sent: 0, failed: [], remaining: Math.max(0, pending.length - candidates.length) };
  }

  const { setup } = result;
  const images = await loadCertificateImages({
    settings: setup.settings,
    mode: 'DIGITAL',
    logoUrl: setup.logoUrl,
    stampUrl: setup.stampUrl,
  });

  // The organizer, not a no-reply mailbox, is who a participant would answer.
  const d = await db.read();
  const replyTo = setup.program.mentorId
    ? (d.mentors ?? []).find((m) => m.id === setup.program.mentorId)?.email
    : (d.incubators ?? []).find((i) => i.id === setup.program.incubatorId)?.email;

  const sentIds: string[] = [];
  const failed: Array<{ registrationId: string; fullName: string }> = [];

  for (const item of batch) {
    let ok = false;
    try {
      const pdf = await renderIssuedCertificates(setup, [item], 'DIGITAL', images);
      const { subject, html } = certificateEmail(item);
      ok = await sendResendEmail({
        to: item.registration.email,
        subject,
        html,
        replyTo: replyTo ?? undefined,
        attachments: [{
          filename: certificateFilename(`Attestation - ${item.certificate.fullName}`),
          content: pdf,
        }],
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[certificates] send failed', item.certificate.number, err instanceof Error ? err.message : err);
    }
    if (ok) sentIds.push(item.certificate.id);
    else failed.push({ registrationId: item.registration.id, fullName: item.registration.fullName });
  }

  // Stamp what went out and release every claim, sent or failed — a failure
  // must be retryable at once, not after the claim times out.
  const now = new Date().toISOString();
  const sent = new Set(sentIds);
  await db.update((draft) => {
    for (const c of draft.certificates ?? []) {
      if (!claimedIds.has(c.id)) continue;
      c.emailClaimedAt = null;
      if (sent.has(c.id)) { c.emailedAt = now; c.updatedAt = now; }
    }
  });

  return {
    ok: true,
    sent: sentIds.length,
    failed,
    remaining: Math.max(0, pending.length - candidates.length),
  };
}
