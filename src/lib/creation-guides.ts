/**
 * Business-creation guides for the copilot: which legal form fits, then the
 * steps to create it. THE source for the guides UI, the progress API and the
 * guide passages the copilot answers from.
 *
 * Text lives in next-intl (`guides.*`); this file only holds the structure,
 * the official links and the downloadable forms. Client-safe: no I/O.
 */

export const GUIDE_IDS = ['SARL', 'EURL', 'PP', 'AE'] as const;
export type GuideId = (typeof GUIDE_IDS)[number];

export const STEP_IDS = [
  'statuts',
  'local',
  'quittance',
  'cnrcMorale',
  'cnrcPhysique',
  'cachet',
  'nif',
  'existence',
  'casnos',
  'nis',
  'banque',
  'anaeAccount',
  'aeCard',
  'aeNif',
  'aeCasnos',
] as const;
export type StepId = (typeof STEP_IDS)[number];

export interface GuideStep {
  id: StepId;
  /** Official pages, shown as link chips. */
  links: { href: string; label: string }[];
  /** A form the user can download from Metwork. */
  download?: { href: string; label: string };
  /** Has a `guides.steps.<id>.duration` string. */
  hasDuration?: boolean;
}

const STEP: Record<StepId, GuideStep> = {
  statuts: { id: 'statuts', links: [] },
  local: { id: 'local', links: [] },
  quittance: { id: 'quittance', links: [{ href: 'https://tabioucom.mf.gov.dz/acheter', label: 'tabioucom.mf.gov.dz' }] },
  cnrcMorale: { id: 'cnrcMorale', links: [{ href: 'https://sidjilcom.cnrc.dz/', label: 'sidjilcom.cnrc.dz' }], hasDuration: true },
  cnrcPhysique: { id: 'cnrcPhysique', links: [{ href: 'https://sidjilcom.cnrc.dz/', label: 'sidjilcom.cnrc.dz' }], hasDuration: true },
  cachet: { id: 'cachet', links: [] },
  nif: { id: 'nif', links: [{ href: 'https://nifenligne.mf.gov.dz/DIDindexDemande2.asp', label: 'nifenligne.mf.gov.dz' }], hasDuration: true },
  existence: { id: 'existence', links: [], download: { href: '/forms/g08.pdf', label: 'G08' } },
  casnos: { id: 'casnos', links: [] },
  nis: { id: 'nis', links: [] },
  banque: { id: 'banque', links: [] },
  anaeAccount: { id: 'anaeAccount', links: [{ href: 'https://anae.dz/', label: 'anae.dz' }] },
  aeCard: { id: 'aeCard', links: [{ href: 'https://anae.dz/', label: 'anae.dz' }] },
  aeNif: { id: 'aeNif', links: [{ href: 'https://nifenligne.mf.gov.dz/DIDindexDemande2.asp', label: 'nifenligne.mf.gov.dz' }] },
  aeCasnos: { id: 'aeCasnos', links: [] },
};

const MORALE: StepId[] = ['statuts', 'local', 'quittance', 'cnrcMorale', 'cachet', 'nif', 'existence', 'casnos', 'nis', 'banque'];

export const GUIDE_STEPS: Record<GuideId, StepId[]> = {
  SARL: MORALE,
  EURL: MORALE,
  // Same path without the notary's statuts and without the NIS.
  PP: ['local', 'quittance', 'cnrcPhysique', 'cachet', 'nif', 'existence', 'casnos', 'banque'],
  AE: ['anaeAccount', 'aeCard', 'aeNif', 'aeCasnos'],
};

export function stepsOf(guide: GuideId): GuideStep[] {
  return GUIDE_STEPS[guide].map((id) => STEP[id]);
}

export function isGuideId(v: unknown): v is GuideId {
  return typeof v === 'string' && (GUIDE_IDS as readonly string[]).includes(v);
}

/* ─────────────────────────── Chooser ─────────────────────────── */

export type Offer = 'PRODUCTS' | 'SERVICES';
export type Partners = 'ALONE' | 'PARTNERS';
export type Capital = 'SMALL' | 'MEDIUM' | 'LARGE';

export interface ChooserAnswers {
  offer: Offer;
  partners: Partners;
  capital: Capital;
}

export interface Recommendation {
  guide: GuideId;
  /** The runner-up worth comparing with. */
  alternative: GuideId;
  /** `guides.why.<reason>` */
  reason: 'partners' | 'services' | 'products' | 'bigAlone';
}

/**
 * Metwork's advice, in this order:
 *  - with a partner → SARL;
 *  - alone with a large capital → EURL (a company of one);
 *  - alone selling a service (freelance) → auto-entrepreneur card;
 *  - alone selling products (small business, e-commerce) → personne physique.
 */
export function recommend(a: ChooserAnswers): Recommendation {
  if (a.partners === 'PARTNERS') return { guide: 'SARL', alternative: 'EURL', reason: 'partners' };
  if (a.capital === 'LARGE') return { guide: 'EURL', alternative: a.offer === 'SERVICES' ? 'AE' : 'PP', reason: 'bigAlone' };
  if (a.offer === 'SERVICES') return { guide: 'AE', alternative: 'PP', reason: 'services' };
  return { guide: 'PP', alternative: 'EURL', reason: 'products' };
}

/* ─────────────────────────── Progress ─────────────────────────── */

export interface GuideProgressView {
  guide: GuideId;
  done: StepId[];
  updatedAt: string;
}

/** The first step not done yet, or null when the guide is finished. */
export function nextStep(guide: GuideId, done: readonly StepId[]): StepId | null {
  return GUIDE_STEPS[guide].find((s) => !done.includes(s)) ?? null;
}

/** Keep only real steps of this guide, in guide order, without duplicates. */
export function normalizeDone(guide: GuideId, done: readonly string[]): StepId[] {
  return GUIDE_STEPS[guide].filter((s) => done.includes(s));
}
