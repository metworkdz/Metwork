/**
 * Will this client's legal block be empty on an invoice?
 *
 * An invoice prints RC / NIF / NIS / AI only for a client filed as an
 * Entreprise. Two ways to end up with a bare « Déstinataire »:
 *  - an Entreprise with neither RC nor NIF on file;
 *  - a company filed as a Personne physique — typical of a record created
 *    automatically from a booking (no type at all), named « SARL … ».
 *
 * Pure: used by the invoice forms on the client.
 */
export type ClientLegalGap = 'COMPANY_NO_LEGAL' | 'LOOKS_LIKE_COMPANY';

const COMPANY_NAME = /^\s*(s\.?a\.?r\.?l|e\.?u\.?r\.?l|s\.?p\.?a|s\.?n\.?c|ets|établissement|etablissement|entreprise|société|societe|groupe|cabinet|agence)\b/i;

export function clientLegalGap(c: {
  clientType?: 'COMPANY' | 'INDIVIDUAL' | null;
  fullName?: string | null;
  companyName?: string | null;
  legalName?: string | null;
  rc?: string | null;
  nif?: string | null;
}): ClientLegalGap | null {
  if (c.clientType === 'COMPANY') {
    return (c.rc ?? '').trim() || (c.nif ?? '').trim() ? null : 'COMPANY_NO_LEGAL';
  }
  const names = [c.fullName, c.companyName, c.legalName].filter(Boolean) as string[];
  return names.some((n) => COMPANY_NAME.test(n)) ? 'LOOKS_LIKE_COMPANY' : null;
}
