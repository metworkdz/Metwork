/**
 * The LinkedIn post a participant publishes with their certificate — ONE
 * builder, read by the preview page (what they are about to post) and by the
 * publisher (what LinkedIn receives), so the two can never differ.
 *
 * The text is a list of segments: plain text, and the one @mention of the
 * Metwork page. Two renderings come out of it:
 *   - `little` — LinkedIn's commentary format. Every reserved character in
 *     plain text is backslash-escaped (LinkedIn rejects or garbles them
 *     otherwise — a certificate link carries `_` and `-`), and the mention is
 *     `@[Name](urn:li:organization:ID)`, which LinkedIn turns into a real,
 *     clickable tag only when Name matches the page name exactly.
 *   - `segments` — for the preview, which shows the tag highlighted.
 *
 * Pure and dependency-free: it also runs in the browser.
 */

export type PostLang = 'fr' | 'en' | 'ar';

export type PostSegment =
  | { kind: 'text'; text: string }
  | { kind: 'mention'; name: string }
  /** One word, letters and digits only, written without its "#". */
  | { kind: 'hashtag'; tag: string };

export interface PostInput {
  lang: PostLang;
  programTitle: string;
  /** The incubator or consultant that organised the training. */
  organizer: string;
  /** Who taught it, when the host filled it in on the certificate. */
  trainerName: string | null;
  /** ISO timestamp — the training's last day. */
  endDate: string;
  /** The certificate's public verification page. */
  verifyUrl: string;
  /** The Metwork LinkedIn page, as LinkedIn spells its name. */
  metwork: { name: string; organizationId: string | null };
}

const INTL_LOCALE: Record<PostLang, string> = { fr: 'fr-FR', en: 'en-GB', ar: 'ar-DZ' };

export function formatPostDay(lang: PostLang, iso: string): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[lang], {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Algiers',
  }).format(new Date(iso));
}

/** Organised by Metwork itself: say it once, as the tag. */
function organizerIsMetwork(organizer: string, metworkName: string): boolean {
  const norm = (s: string) => s.trim().toLowerCase();
  return norm(organizer) === norm(metworkName) || norm(organizer) === 'metwork';
}

export function buildPostSegments(input: PostInput): PostSegment[] {
  const { lang, programTitle, verifyUrl, metwork } = input;
  const organizer = input.organizer.trim();
  const trainer = input.trainerName?.trim() || null;
  const day = formatPostDay(lang, input.endDate);
  const byMetwork = organizerIsMetwork(organizer, metwork.name);

  const segs: PostSegment[] = [];
  const t = (text: string) => segs.push({ kind: 'text', text });
  const tag = () => segs.push({ kind: 'mention', name: metwork.name });
  const hashtags = (...tags: string[]) => tags.forEach((h, i) => {
    if (i > 0) t(' ');
    segs.push({ kind: 'hashtag', tag: h });
  });

  if (lang === 'en') {
    t(`🎓 I am pleased to share that I have successfully completed the training “${programTitle}”`);
    if (trainer) t(`, delivered by ${trainer}`);
    if (byMetwork) { t(' and organised by '); tag(); }
    else { t(`, organised by ${organizer} on `); tag(); }
    t(`, which ended on ${day}.\n\n`);
    t(`Many thanks to ${byMetwork ? 'the Metwork team' : organizer}${trainer ? ` and to ${trainer}` : ''} for this enriching experience.\n\n`);
    t(`🔎 My certificate can be verified here: ${verifyUrl}\n\n`);
    hashtags('Training', 'LifelongLearning', 'Metwork');
  } else if (lang === 'ar') {
    t(`🎓 يسعدني أن أعلن أنني أتممت بنجاح التكوين « ${programTitle} »`);
    if (trainer) t(` الذي قدّمه ${trainer}`);
    if (byMetwork) { t('، والذي نظّمته '); tag(); }
    else { t(`، والذي نظّمه ${organizer} عبر منصة `); tag(); }
    t(`، والذي اختُتم بتاريخ ${day}.\n\n`);
    t(`شكراً جزيلاً لـ${byMetwork ? 'فريق Metwork' : organizer}${trainer ? ` و${trainer}` : ''} على هذه التجربة المثرية.\n\n`);
    t(`🔎 يمكن التحقق من شهادتي هنا: ${verifyUrl}\n\n`);
    hashtags('تكوين', 'Metwork');
  } else {
    t(`🎓 J’ai le plaisir de vous annoncer que j’ai suivi avec succès la formation « ${programTitle} »`);
    if (trainer) t(`, animée par ${trainer}`);
    if (byMetwork) { t(' et organisée par '); tag(); }
    else { t(`, organisée par ${organizer} sur `); tag(); }
    t(`, achevée le ${day}.\n\n`);
    t(`Un grand merci à ${byMetwork ? 'l’équipe Metwork' : organizer}${trainer ? ` et à ${trainer}` : ''} pour cette formation enrichissante.\n\n`);
    t(`🔎 Mon attestation est vérifiable ici : ${verifyUrl}\n\n`);
    hashtags('Formation', 'Apprentissage', 'Metwork');
  }
  return segs;
}

/** Every character `little` reserves, escaped with a backslash. */
export function escapeLittle(text: string): string {
  return text.replace(/[\\|{}@[\]()<>#*_~]/g, (c) => `\\${c}`);
}

/** The commentary LinkedIn receives. */
export function toLittle(segments: PostSegment[], organizationId: string | null): string {
  return segments
    .map((s) => {
      if (s.kind === 'text') return escapeLittle(s.text);
      if (s.kind === 'hashtag') return /^[\p{L}\p{N}]+$/u.test(s.tag) ? `#${s.tag}` : escapeLittle(`#${s.tag}`);
      // Without the page id there is nothing to tag — the name stays plain.
      return organizationId ? `@[${escapeLittle(s.name)}](urn:li:organization:${organizationId})` : escapeLittle(s.name);
    })
    .join('');
}

/** The text as a reader sees it, tag and all. */
export function toPlain(segments: PostSegment[]): string {
  return segments
    .map((s) => (s.kind === 'text' ? s.text : s.kind === 'hashtag' ? `#${s.tag}` : `@${s.name}`))
    .join('');
}

/** LinkedIn's commentary limit. Ours stays far below it; the check is a guard. */
export const LINKEDIN_COMMENTARY_MAX = 3000;
