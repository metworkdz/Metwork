/**
 * The words on a certificate — pure, and free of server imports so the editor
 * can use the same functions to warn about an empty variable before anything
 * is rendered.
 */
import type {
  CertificateContext,
  CertificateRecipient,
  CertificateSettings,
} from './types';

/* ─────────────────── Dates ─────────────────── */

/**
 * Algeria, always. Program dates are stored noon-anchored in local time; read
 * in UTC they would still land on the right day, but naming the zone makes
 * that a guarantee rather than a coincidence of the anchor.
 */
const TZ = 'Africa/Algiers';

function parts(iso: string): { day: number; month: string; year: number; ym: string } | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const get = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, ...opts }).format(d);
  const day = Number(get({ day: 'numeric' }));
  const month = get({ month: 'long' });
  const year = Number(get({ year: 'numeric' }));
  return { day, month, year, ym: `${year}-${month}` };
}

/** "1er février 2026" — French writes the first of the month as an ordinal. */
function dayLabel(day: number): string {
  return day === 1 ? '1er' : String(day);
}

/**
 * No-break space. A date is one unit on a certificate: "le 14 / février 2026"
 * split across two lines reads as a mistake, so every date is glued together
 * and the paragraph layout never breaks inside it.
 */
const NB = '\u00a0';

/** "14 février 2026", unbreakable. */
export function formatCertificateDay(iso: string): string {
  const p = parts(iso);
  return p ? `${dayLabel(p.day)}${NB}${p.month}${NB}${p.year}` : '';
}

/**
 * The whole span, preposition included, so the body reads naturally for a
 * one-day training and a two-week one alike:
 *
 *   same day      → "le 14 février 2026"
 *   same month    → "du 8 au 20 septembre 2026"
 *   same year     → "du 28 septembre au 3 octobre 2026"
 *   across years  → "du 28 décembre 2026 au 3 janvier 2027"
 */
export function formatCertificateDates(startIso: string, endIso: string): string {
  const a = parts(startIso);
  const b = parts(endIso);
  if (!a) return '';
  // A span may break around "au", never inside either date.
  if (!b || (a.day === b.day && a.ym === b.ym)) return `le${NB}${formatCertificateDay(startIso)}`;
  if (a.ym === b.ym) return `du${NB}${dayLabel(a.day)} au${NB}${dayLabel(b.day)}${NB}${b.month}${NB}${b.year}`;
  if (a.year === b.year) {
    return `du${NB}${dayLabel(a.day)}${NB}${a.month} au${NB}${dayLabel(b.day)}${NB}${b.month}${NB}${b.year}`;
  }
  return `du${NB}${formatCertificateDay(startIso)} au${NB}${formatCertificateDay(endIso)}`;
}

/* ─────────────────── Variables ─────────────────── */

export function certificateVariables(
  settings: Pick<CertificateSettings, 'trainerName' | 'hours'>,
  context: CertificateContext,
  recipient?: Pick<CertificateRecipient, 'fullName'>,
): Record<string, string> {
  return {
    '{programme}': context.programTitle.trim(),
    '{organisme}': context.organizer.trim(),
    '{formateur}': (settings.trainerName ?? '').trim(),
    // Empty while the program's dates are to confirm — the editor then flags
    // {dates} as an empty variable, and issuing waits for real dates.
    '{dates}': context.startDate && context.endDate ? formatCertificateDates(context.startDate, context.endDate) : '',
    '{date}': context.startDate ? formatCertificateDay(context.startDate) : '',
    '{ville}': context.city.trim(),
    '{heures}': (settings.hours ?? '').trim(),
    '{nom}': (recipient?.fullName ?? '').trim(),
  };
}

const VARIABLE_RE = /\{[a-z]+\}/g;

/**
 * Replace every {variable}, dropping each [[optional]] passage that contains
 * an empty one.
 *
 * Without the optional passages, a program with no trainer would print
 * "organisée par Metwork, et animée par , tenue le…". An unknown {variable}
 * is left as typed, so a typo shows on the preview instead of vanishing.
 */
export function fillCertificateText(template: string, vars: Record<string, string>): string {
  const withOptional = template.replace(/\[\[([\s\S]*?)\]\]/g, (_, inner: string) => {
    const used = inner.match(VARIABLE_RE) ?? [];
    const anyEmpty = used.some((v) => v in vars && !vars[v]);
    return anyEmpty ? '' : inner;
  });
  return withOptional
    .replace(VARIABLE_RE, (v) => (v in vars ? vars[v]! : v))
    // An empty variable outside an optional passage still leaves its
    // punctuation behind; tidy the obvious cases rather than print them.
    .replace(/[ \t]+,/g, ',')
    .replace(/,[ \t]*,/g, ',')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
    .replace(/(^|[\s(])(M\.|Mme\.?|Mlle\.?|Dr\.?|Pr\.?)[ \t]+(?=\S)/g, `$1$2${NB}`)
    .replace(/«[ \t]+/g, `«${NB}`)
    .replace(/[ \t]+»/g, `${NB}»`);
}

/*
 * The last three lines glue what French typography never separates: a title
 * from the name after it ("M. / Rafik" was the first line break the Cormorant
 * sample produced) and the guillemets from what they quote.
 */

/** Variables used in `template` that would come out empty — for the editor. */
export function emptyVariablesIn(template: string, vars: Record<string, string>): string[] {
  const outsideOptional = template.replace(/\[\[[\s\S]*?\]\]/g, '');
  const used = new Set(outsideOptional.match(VARIABLE_RE) ?? []);
  return [...used].filter((v) => v in vars && !vars[v]);
}

/* ─────────────────── Bold runs ─────────────────── */

export interface TextRun {
  text: string;
  bold: boolean;
}

/**
 * Split "tenue **le 14 février 2026**, à Oran" into plain and bold runs. An
 * unmatched "**" is printed as-is rather than turning the rest of the
 * paragraph bold.
 */
export function parseBoldRuns(text: string): TextRun[] {
  const runs: TextRun[] = [];
  const re = /\*\*([^*]+)\*\*/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) runs.push({ text: text.slice(last, m.index), bold: false });
    runs.push({ text: m[1]!, bold: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last), bold: false });
  return runs.filter((r) => r.text.length > 0);
}

/* ─────────────────── The name ─────────────────── */

const ARABIC_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;

export function isArabicText(s: string): boolean {
  return ARABIC_RE.test(s);
}

/**
 * The name line: civility as typed, then the name in uppercase — "Mme. AMARA
 * DJIHENE HIND", as on the model.
 *
 * Arabic has no case, so an Arabic name is printed exactly as registered;
 * `toLocaleUpperCase` would leave it unchanged anyway, but saying so here
 * keeps the next reader from "fixing" it.
 */
export function certificateNameParts(
  recipient: Pick<CertificateRecipient, 'fullName' | 'civility'>,
): { civility: string; name: string } {
  const name = recipient.fullName.trim().replace(/\s+/g, ' ');
  const upper = isArabicText(name) ? name : name.toLocaleUpperCase('fr-FR');
  const civility = recipient.civility === 'Mme' ? 'Mme.' : recipient.civility === 'M.' ? 'M.' : '';
  return { civility, name: upper };
}

export function certificateNameLine(recipient: Pick<CertificateRecipient, 'fullName' | 'civility'>): string {
  const { civility, name } = certificateNameParts(recipient);
  return civility ? `${civility} ${name}` : name;
}

/* ─────────────────── Colors ─────────────────── */

const HEX_RE = /^#[0-9a-f]{6}$/i;

export function isHexColor(s: string): boolean {
  return HEX_RE.test(s);
}

function mix(hex: string, target: number, amount: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) =>
    Math.round(c + (target - c) * amount),
  );
  return `#${ch.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * The four greens of the model — deepest in the corner, lightest at the edge
 * of the white — derived from the two colors a host picks, so any palette
 * keeps the same depth.
 */
export function certificateTones(primary: string, dark: string): {
  dark: string; mid: string; soft: string; pale: string;
} {
  const p = isHexColor(primary) ? primary : '#3fb34f';
  const d = isHexColor(dark) ? dark : '#0b7a3d';
  return { dark: d, mid: p, soft: mix(p, 255, 0.18), pale: mix(p, 255, 0.36) };
}
