/**
 * Emailing the feedback form — to every confirmed participant who has not had
 * it yet, or to the people the host picks.
 *
 * Batched like the certificates: one request sends at most SEND_BATCH emails
 * and says how many are left; the page calls again until none are. A batch is
 * claimed in one write before anything is sent, so two tabs never email the
 * same person, and a run that fails halfway has already stamped what went
 * out — asking again never emails anyone twice. Naming people explicitly is
 * the host's « Renvoyer », and sends again on purpose.
 *
 * The link in the email is the participant's personal one: signed, the same
 * on every resend (./tokens).
 */
import { db, type FeedbackInviteRecord, type RegistrationRecord } from '@/server/db/store';
import {
  layout,
  normalizeEmailLang,
  sendResendEmail,
  type EmailLang,
} from '@/server/notifications/email';
import { programOwnedBy } from '@/server/certificates/service';
import type { OwnerScope } from '@/server/registrations/service';

import { ensureFeedbackInvitesSync } from './service';
import { feedbackUrl, personalFeedbackToken } from './tokens';

/** Emails per request — comfortably inside a 60-second function. */
export const FEEDBACK_SEND_BATCH = 20;

/** A claim older than this belongs to a run that died. */
const CLAIM_TTL_MS = 5 * 60_000;

const COPY: Record<EmailLang, {
  subject: (title: string) => string;
  heading: string;
  greeting: (name: string) => string;
  thanks: (title: string, organizer: string) => string;
  ask: string;
  short: string;
  cta: string;
  privacy: string;
}> = {
  fr: {
    subject: (t) => `Votre avis sur « ${t} »`,
    heading: 'Merci pour votre participation !',
    greeting: (n) => `Bonjour <strong>${n}</strong>,`,
    thanks: (t, o) => `Merci d’avoir participé à la formation <strong>« ${t} »</strong>${o ? `, organisée par ${o}` : ''}.`,
    ask: 'Nous aimerions connaître votre avis sur cette formation : il nous aide à nous améliorer et à vous proposer des formations toujours meilleures.',
    short: 'Cela prend moins de 2 minutes.',
    cta: 'Donner mon avis',
    privacy: 'Votre avis est privé : il est lu uniquement par l’équipe organisatrice et n’est jamais publié.',
  },
  en: {
    subject: (t) => `Your opinion of “${t}”`,
    heading: 'Thank you for taking part!',
    greeting: (n) => `Hello <strong>${n}</strong>,`,
    thanks: (t, o) => `Thank you for taking part in <strong>“${t}”</strong>${o ? `, organised by ${o}` : ''}.`,
    ask: 'We would like to know what you thought of this training: your opinion helps us improve and offer you ever better trainings.',
    short: 'It takes less than 2 minutes.',
    cta: 'Give my feedback',
    privacy: 'Your feedback is private: only the organising team reads it, and it is never published.',
  },
  ar: {
    subject: (t) => `رأيك في « ${t} »`,
    heading: 'شكراً لمشاركتك!',
    greeting: (n) => `مرحباً <strong>${n}</strong>،`,
    thanks: (t, o) => `شكراً لمشاركتك في التكوين <strong>« ${t} »</strong>${o ? ` الذي نظّمه ${o}` : ''}.`,
    ask: 'نودّ معرفة رأيك في هذا التكوين: رأيك يساعدنا على التحسّن وعلى أن نقدّم لك تكوينات أفضل.',
    short: 'لا يستغرق الأمر أكثر من دقيقتين.',
    cta: 'أعطِ رأيك',
    privacy: 'رأيك خاص: لا يطّلع عليه إلا فريق التنظيم، ولا يُنشر أبداً.',
  },
};

function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function feedbackEmail(input: {
  registration: Pick<RegistrationRecord, 'fullName' | 'locale'>;
  programTitle: string;
  organizer: string;
  inviteId: string;
}): { subject: string; html: string; url: string } {
  const lang = normalizeEmailLang(input.registration.locale);
  const c = COPY[lang];
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const align = lang === 'ar' ? 'right' : 'left';
  const url = feedbackUrl(personalFeedbackToken(input.inviteId), lang);
  const firstName = input.registration.fullName.trim().split(/\s+/)[0] ?? input.registration.fullName;

  const p = (html: string) => `<p style="margin:0 0 16px;font-size:15px;color:#3f3f46;line-height:1.6;">${html}</p>`;
  const html = layout(`
    <div dir="${dir}" style="text-align:${align};">
      <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#09090b;">${c.heading}</h1>
      ${p(c.greeting(esc(firstName)))}
      ${p(c.thanks(esc(input.programTitle), esc(input.organizer)))}
      ${p(c.ask)}
      ${p(c.short)}
      <p style="margin:0 0 20px;">
        <a href="${esc(url)}" style="display:inline-block;padding:12px 24px;background:#30a735;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">${c.cta}</a>
      </p>
      <p style="margin:0;font-size:13px;color:#71717a;line-height:1.5;">🔒 ${c.privacy}</p>
    </div>
  `, { lang: lang === 'en' ? 'en' : 'fr' });

  // A header line: no line breaks from a host-typed title may reach it.
  const subject = c.subject(input.programTitle).replace(/[\r\n\t]+/g, ' ').trim();
  return { subject, html, url };
}

export type FeedbackSendResult =
  | {
      ok: true;
      sent: number;
      failed: Array<{ registrationId: string; fullName: string }>;
      remaining: number;
    }
  | { ok: false; reason: 'NOT_FOUND' | 'NOT_SAVED' | 'CLOSED' | 'NONE' | 'TOO_MANY' };

/**
 * Send the form. `registrationIds` given: those people, even if already sent
 * (a resend). Omitted: every confirmed participant not sent it yet, minus
 * `skip` — who already failed in this run, so a bad address is not retried in
 * a loop.
 */
export async function sendFeedbackInvites(
  programId: string,
  owner: OwnerScope,
  opts: { registrationIds?: string[]; skip?: string[] } = {},
): Promise<FeedbackSendResult> {
  // An explicit list is a resend: it must fit one request, or calling again
  // for the rest would email the first ones twice.
  if (opts.registrationIds && opts.registrationIds.length > FEEDBACK_SEND_BATCH) return { ok: false, reason: 'TOO_MANY' };
  const skip = new Set(opts.skip ?? []);

  type Claimed = { invite: FeedbackInviteRecord; registration: RegistrationRecord };
  type Plan =
    | { ok: false; reason: 'NOT_FOUND' | 'NOT_SAVED' | 'CLOSED' | 'NONE' }
    | { ok: true; batch: Claimed[]; remaining: number; programTitle: string; organizer: string; replyTo: string | null };

  // One write: create the missing invites and claim this batch.
  const plan = await db.update<Plan>((d) => {
    const program = (d.programs ?? []).find((p) => p.id === programId);
    if (!program || !programOwnedBy(program, owner)) return { ok: false, reason: 'NOT_FOUND' };
    const form = (d.feedbackForms ?? []).find((f) => f.programId === programId);
    if (!form) return { ok: false, reason: 'NOT_SAVED' };
    if (!form.isOpen) return { ok: false, reason: 'CLOSED' };

    const confirmed = (d.registrations ?? []).filter(
      (r) => r.entityType === 'PROGRAM' && r.entityId === programId && r.status === 'CONFIRMED',
    );
    const wanted = opts.registrationIds
      ? confirmed.filter((r) => opts.registrationIds!.includes(r.id))
      : confirmed.filter((r) => !skip.has(r.id));
    if (wanted.length === 0) return { ok: false, reason: 'NONE' };

    const invites = ensureFeedbackInvitesSync(d, form, wanted.map((r) => r.id));
    const nowMs = Date.now();
    const pending = invites.filter((i) => {
      if (opts.registrationIds) return true;
      const claimAlive = i.emailClaimedAt && nowMs - Date.parse(i.emailClaimedAt) < CLAIM_TTL_MS;
      return !i.sentAt && !claimAlive;
    });
    const batch = pending.slice(0, FEEDBACK_SEND_BATCH);
    for (const i of batch) i.emailClaimedAt = new Date(nowMs).toISOString();

    const organizer = program.mentorId
      ? (d.mentors ?? []).find((m) => m.id === program.mentorId)
      : (d.incubators ?? []).find((i) => i.id === program.incubatorId);
    return {
      ok: true,
      batch: batch.map((invite) => ({ invite: { ...invite }, registration: wanted.find((r) => r.id === invite.registrationId)! })),
      remaining: pending.length - batch.length,
      programTitle: program.title,
      organizer: (organizer && ('fullName' in organizer ? organizer.fullName : organizer.name)) ?? '',
      // The organizer, not a no-reply mailbox, is who a participant would answer.
      replyTo: organizer?.email ?? null,
    };
  });
  if (!plan.ok) return plan;

  const sentIds = new Set<string>();
  const failed: Array<{ registrationId: string; fullName: string }> = [];
  for (const { invite, registration } of plan.batch) {
    let ok = false;
    try {
      const { subject, html } = feedbackEmail({
        registration, programTitle: plan.programTitle, organizer: plan.organizer, inviteId: invite.id,
      });
      ok = await sendResendEmail({ to: registration.email, subject, html, replyTo: plan.replyTo ?? undefined });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[feedback] send failed', invite.id, err instanceof Error ? err.message : err);
    }
    if (ok) sentIds.add(invite.id);
    else failed.push({ registrationId: registration.id, fullName: registration.fullName });
  }

  // Stamp what went out and release every claim — a failure must be
  // retryable at once, not after the claim times out.
  const claimed = new Set(plan.batch.map((b) => b.invite.id));
  const now = new Date().toISOString();
  await db.update((d) => {
    for (const i of d.feedbackInvites ?? []) {
      if (!claimed.has(i.id)) continue;
      i.emailClaimedAt = null;
      if (sentIds.has(i.id)) i.sentAt = now;
    }
  });

  return { ok: true, sent: sentIds.size, failed, remaining: plan.remaining };
}
