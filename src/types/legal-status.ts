/**
 * Legal status of a business on Metwork — shared by freelancer profiles and
 * entrepreneur ventures (Metwork 2.0).
 *
 * It answers two downstream questions, so it is modelled once here instead of
 * per feature:
 *   - which legal document proves the business exists (profile completion and
 *     the automatic document review), and
 *   - which tax and social obligations apply (the tax center).
 *
 * Client-safe: no server imports, so forms can import the values directly.
 */

export const LEGAL_STATUSES = [
  /** Project or activity not registered yet. No tax obligations. */
  'UNREGISTERED',
  /** Statut auto-entrepreneur (carte d'auto-entrepreneur). */
  'AUTO_ENTREPRENEUR',
  /** Natural person registered at the CNRC (commerçant, artisan), IFU regime. */
  'INDIVIDUAL_IFU',
  /** Profession libérale (BNC income). */
  'LIBERAL_PROFESSION',
  /** Legal person: SARL, EURL, SPA, SNC, SPAS, SPASU. */
  'COMPANY',
  /** Association or NGO. */
  'ASSOCIATION',
] as const;
export type LegalStatus = (typeof LEGAL_STATUSES)[number];

export const COMPANY_FORMS = ['SARL', 'EURL', 'SPA', 'SNC', 'SPAS', 'SPASU'] as const;
export type CompanyForm = (typeof COMPANY_FORMS)[number];

/** Tax regime. `null` on a record means "not chosen yet", never a default. */
export const TAX_REGIMES = ['IFU', 'REEL'] as const;
export type TaxRegime = (typeof TAX_REGIMES)[number];

/** Documents accepted as proof of a registered business. */
export const LEGAL_DOCUMENT_KINDS = ['AUTO_ENTREPRENEUR_CARD', 'COMMERCE_REGISTER'] as const;
export type LegalDocumentKind = (typeof LEGAL_DOCUMENT_KINDS)[number];

/** The legal block a profile or venture carries. Every field optional except status. */
export interface LegalIdentity {
  status: LegalStatus;
  /** Set only when `status === 'COMPANY'`. */
  companyForm?: CompanyForm | null;
  /** `null` = not chosen. See `defaultTaxRegimeFor` for the pre-filled value. */
  taxRegime?: TaxRegime | null;
  /** Holds the national Label Startup. A label on a business, not a status. */
  hasStartupLabel?: boolean;
}

export function isLegalStatus(value: unknown): value is LegalStatus {
  return typeof value === 'string' && (LEGAL_STATUSES as readonly string[]).includes(value);
}

export function requiresCompanyForm(status: LegalStatus): boolean {
  return status === 'COMPANY';
}

/**
 * The regime a form pre-fills for a status, or `null` when the status alone
 * does not settle it and the user must choose (liberal professions) or when
 * no tax regime applies (unregistered, association).
 */
export function defaultTaxRegimeFor(status: LegalStatus): TaxRegime | null {
  switch (status) {
    case 'AUTO_ENTREPRENEUR':
    case 'INDIVIDUAL_IFU':
      return 'IFU';
    case 'COMPANY':
      return 'REEL';
    case 'LIBERAL_PROFESSION':
    case 'ASSOCIATION':
    case 'UNREGISTERED':
      return null;
  }
}

/**
 * Which documents prove a status. Empty means the status has no document the
 * automatic review can check yet; those go to the admin queue (phase 2).
 */
export function acceptedDocumentsFor(status: LegalStatus): readonly LegalDocumentKind[] {
  switch (status) {
    case 'AUTO_ENTREPRENEUR':
      return ['AUTO_ENTREPRENEUR_CARD'];
    case 'INDIVIDUAL_IFU':
    case 'COMPANY':
      return ['COMMERCE_REGISTER'];
    case 'LIBERAL_PROFESSION':
    case 'ASSOCIATION':
    case 'UNREGISTERED':
      return [];
  }
}
