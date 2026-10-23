/**
 * Tax & social calendar — THE rule table behind the tax center (Metwork 2.0
 * phase 4). Client-safe and pure: the page, the API and the reminder cron all
 * generate the same tasks from it.
 *
 * Every rule cites where it comes from. Rules are read from the official texts
 * in `tax documents/` (2025 G-series forms and their notices, the 2026 tax
 * codes, the finance laws). The one exception is CASNOS — no CASNOS text is in
 * the folder — whose dates are the owner's instruction of 2026-10-23 and are
 * labelled as such. Have an accountant validate the table before relying on it.
 */
import type { LegalStatus, TaxRegime } from '@/types/legal-status';
import { defaultTaxRegimeFor } from '@/types/legal-status';

export const OBLIGATION_IDS = [
  'G12',
  'G12_BIS',
  'IFU_INSTALMENT_SEPT',
  'IFU_INSTALMENT_DEC',
  'CASNOS_DECLARATION',
  'CASNOS_PAYMENT',
  'G50',
  'G4',
  'G11',
  'G13',
] as const;
export type ObligationId = (typeof OBLIGATION_IDS)[number];

export interface RuleSource {
  /** Document in `tax documents/`, or null for an owner instruction. */
  document: string | null;
  /** Article or section, as printed. */
  reference: string;
}

export interface ObligationRule {
  id: ObligationId;
  cadence: 'ANNUAL' | 'MONTHLY';
  /** Official form name, when there is one. */
  form: string | null;
  source: RuleSource;
  /** Reminders start this many days before the deadline (plus J-7 and J-1). */
  firstReminderDays: number;
  /** First reminder on 1 January of the deadline's year instead (leap-year safe). */
  remindFromJan1?: true;
}

/** Turnover ceilings and minimums, with their sources. */
export const TAX_FIGURES = {
  /** LF 2023 art. 51. */
  aeCeiling: 5_000_000,
  /** CIDTA 2026 art. 282 ter. */
  ifuCeiling: 8_000_000,
  /** CIDTA 2026 art. 282 sexies, as amended by LF 2024 art. 18. */
  aeIfuRate: 0.005,
  /** GN°12 bis (2025) notice: minimum IFU for an auto-entrepreneur / for others. */
  aeMinimumIfu: 10_000,
  ifuMinimum: 30_000,
} as const;

const FORMS = 'Formulaires de déclaration';

export const OBLIGATION_RULES: Record<ObligationId, ObligationRule> = {
  G12: {
    id: 'G12', cadence: 'ANNUAL', form: 'Série G N°12',
    source: { document: `${FORMS}/GN° 12 Prévisionelle - 2025.pdf`, reference: 'Art. 1er CPF — au plus tard le 30 juin' },
    firstReminderDays: 15,
  },
  G12_BIS: {
    id: 'G12_BIS', cadence: 'ANNUAL', form: 'Série G N°12 bis',
    source: { document: `${FORMS}/GN° 12 Bis définitive - 2025.pdf`, reference: 'Art. 282 quater CIDTA — au plus tard le 20 janvier N+1' },
    firstReminderDays: 15,
  },
  IFU_INSTALMENT_SEPT: {
    id: 'IFU_INSTALMENT_SEPT', cadence: 'ANNUAL', form: null,
    source: { document: `${FORMS}/GN° 12 Prévisionelle - 2025.pdf`, reference: 'Notice — 2e versement du 1er au 15 septembre' },
    firstReminderDays: 15,
  },
  IFU_INSTALMENT_DEC: {
    id: 'IFU_INSTALMENT_DEC', cadence: 'ANNUAL', form: null,
    source: { document: `${FORMS}/GN° 12 Prévisionelle - 2025.pdf`, reference: 'Notice — 3e versement du 1er au 15 décembre' },
    firstReminderDays: 15,
  },
  CASNOS_DECLARATION: {
    id: 'CASNOS_DECLARATION', cadence: 'ANNUAL', form: null,
    source: { document: null, reference: 'Consigne Metwork du 23/10/2026 — déclaration avant le 1er mars' },
    // Alerts run from 1 January (owner instruction).
    firstReminderDays: 59,
    remindFromJan1: true,
  },
  CASNOS_PAYMENT: {
    id: 'CASNOS_PAYMENT', cadence: 'ANNUAL', form: null,
    source: { document: null, reference: 'Consigne Metwork du 23/10/2026 — paiement avant le 30 juin' },
    // Alerts run from 1 January (owner instruction).
    firstReminderDays: 180,
    remindFromJan1: true,
  },
  G50: {
    id: 'G50', cadence: 'MONTHLY', form: 'Série G N°50',
    source: { document: `${FORMS}/Notice comment remplir GN°50.pdf`, reference: 'Dans les vingt (20) premiers jours du mois suivant' },
    firstReminderDays: 7,
  },
  G4: {
    id: 'G4', cadence: 'ANNUAL', form: 'Série G N°4 (IBS)',
    source: { document: `${FORMS}/GN° 4 -2025.pdf`, reference: 'Au plus tard le 30 avril de chaque année' },
    firstReminderDays: 15,
  },
  G11: {
    id: 'G11', cadence: 'ANNUAL', form: 'Série G N°11 (IRG BIC)',
    source: { document: `${FORMS}/GN° 11 (IRG - BIC).pdf`, reference: 'Au plus tard le 30 avril de chaque année' },
    firstReminderDays: 15,
  },
  G13: {
    id: 'G13', cadence: 'ANNUAL', form: 'Série G N°13 (IRG BNC)',
    source: { document: `${FORMS}/GN° 13 ( IRG - BNC).pdf`, reference: 'Au plus tard le 30 avril de chaque année' },
    firstReminderDays: 15,
  },
};

/** The legal situation the calendar is computed from. */
export interface TaxProfile {
  status: LegalStatus;
  taxRegime?: TaxRegime | null;
}

export function effectiveRegime(p: TaxProfile): TaxRegime | null {
  return p.taxRegime ?? defaultTaxRegimeFor(p.status);
}

/** Which obligations a legal situation carries. Empty = nothing to remind. */
export function obligationsFor(p: TaxProfile): ObligationId[] {
  const regime = effectiveRegime(p);
  const nonSalaried = p.status === 'AUTO_ENTREPRENEUR' || p.status === 'INDIVIDUAL_IFU' || p.status === 'LIBERAL_PROFESSION';
  const out: ObligationId[] = [];
  if (regime === 'IFU' && p.status !== 'COMPANY' && p.status !== 'ASSOCIATION' && p.status !== 'UNREGISTERED') {
    out.push('G12', 'G12_BIS', 'IFU_INSTALMENT_SEPT', 'IFU_INSTALMENT_DEC');
  }
  if (nonSalaried) out.push('CASNOS_DECLARATION', 'CASNOS_PAYMENT');
  if (regime === 'REEL') {
    if (p.status === 'COMPANY') out.push('G50', 'G4');
    if (p.status === 'INDIVIDUAL_IFU' || p.status === 'AUTO_ENTREPRENEUR') out.push('G50', 'G11');
    if (p.status === 'LIBERAL_PROFESSION') out.push('G50', 'G13');
  }
  return out;
}

export interface TaxTask {
  /** Stable key: obligation + the period it covers ("G12:2027", "G50:2026-10"). */
  key: string;
  obligation: ObligationId;
  /** The year (or YYYY-MM) the obligation is about. */
  period: string;
  /** YYYY-MM-DD, the last day to act. */
  dueDate: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** Due dates of one obligation that fall in [from, to] (YYYY-MM-DD, inclusive). */
function occurrences(id: ObligationId, from: string, to: string): TaxTask[] {
  const y0 = Number(from.slice(0, 4)) - 1;
  const y1 = Number(to.slice(0, 4)) + 1;
  const tasks: TaxTask[] = [];
  for (let y = y0; y <= y1; y++) {
    if (id === 'G50') {
      for (let m = 1; m <= 12; m++) {
        // October's G50 is due by 20 November.
        const dueY = m === 12 ? y + 1 : y;
        const dueM = m === 12 ? 1 : m + 1;
        tasks.push({ key: `G50:${y}-${pad(m)}`, obligation: id, period: `${y}-${pad(m)}`, dueDate: ymd(dueY, dueM, 20) });
      }
      continue;
    }
    const due =
      id === 'G12' ? ymd(y, 6, 30)
      // The définitive for year y is due 20 January y+1.
      : id === 'G12_BIS' ? ymd(y + 1, 1, 20)
      : id === 'IFU_INSTALMENT_SEPT' ? ymd(y, 9, 15)
      : id === 'IFU_INSTALMENT_DEC' ? ymd(y, 12, 15)
      : id === 'CASNOS_DECLARATION' ? ymd(y, 3, 1)
      : id === 'CASNOS_PAYMENT' ? ymd(y, 6, 30)
      // G4 / G11 / G13 for year y are filed by 30 April y+1.
      : ymd(y + 1, 4, 30);
    tasks.push({ key: `${id}:${y}`, obligation: id, period: String(y), dueDate: due });
  }
  return tasks.filter((t) => t.dueDate >= from && t.dueDate <= to);
}

/**
 * The tasks to show: everything due from `lookBackDays` ago (so a missed
 * deadline stays visible) to `horizonDays` ahead, soonest first.
 */
export function tasksFor(
  p: TaxProfile,
  today: string,
  { lookBackDays = 60, horizonDays = 365 }: { lookBackDays?: number; horizonDays?: number } = {},
): TaxTask[] {
  const t = new Date(`${today}T00:00:00Z`).getTime();
  const from = new Date(t - lookBackDays * 86_400_000).toISOString().slice(0, 10);
  const to = new Date(t + horizonDays * 86_400_000).toISOString().slice(0, 10);
  return obligationsFor(p)
    .flatMap((id) => occurrences(id, from, to))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.key.localeCompare(b.key));
}

/** Whole days from `today` to the deadline (negative = late). */
export function daysUntil(dueDate: string, today: string): number {
  return Math.round((Date.parse(`${dueDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

/**
 * Which reminder, if any, is due today for a task: the first one at
 * `firstReminderDays`, then J-7 and J-1. Returns the offset to stamp, so the
 * cron sends each one once even if it runs late or twice.
 */
export function reminderDue(task: TaxTask, today: string, sent: readonly number[]): number | null {
  const rule = OBLIGATION_RULES[task.obligation];
  const left = daysUntil(task.dueDate, today);
  if (left < 0) return null;
  const first = rule.remindFromJan1 ? daysUntil(task.dueDate, `${task.dueDate.slice(0, 4)}-01-01`) : rule.firstReminderDays;
  const offsets = [...new Set([first, 7, 1])].sort((a, b) => b - a);
  // The tightest offset already reached that has not been sent.
  const reached = offsets.filter((o) => left <= o);
  const next = reached[reached.length - 1];
  return next !== undefined && !sent.includes(next) ? next : null;
}
