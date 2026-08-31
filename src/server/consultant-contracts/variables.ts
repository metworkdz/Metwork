/**
 * Consultant contract template variable engine.
 *
 * Mirrors the pattern already established for space-booking contracts
 * (`src/server/contracts/variables.ts`): a whitelisted set of `{{tokens}}`,
 * pure string replacement, no eval — an unknown or unresolved token renders
 * as an empty string rather than throwing, so a malformed or partially-filled
 * template can never crash contract creation.
 *
 * Deliberately a SEPARATE module from the space-booking engine, not a shared
 * one: different party (Metwork ↔ consultant, not incubator ↔ client),
 * different token set, different record shapes. Sharing one whitelist would
 * let a token meant for one document silently work in the other.
 */
import { formatCityLabel } from '@/config/cities';
import type { IncubatorRecord, MentorRecord } from './types';

export type ConsultantContractToken =
  | 'consultant_name'
  | 'consultant_phone'
  | 'consultant_email'
  | 'consultant_position'
  | 'consultant_address'
  | 'consultant_city'
  | 'consultant_id_number'
  | 'commission_rate'
  | 'consultant_share'
  | 'payout_method'
  | 'payout_details'
  | 'today'
  | 'metwork_name'
  | 'metwork_address'
  | 'metwork_rc'
  | 'metwork_nif';

/** Ordered token catalogue, shown as a reference chip list in the template editor. */
export const CONSULTANT_CONTRACT_VARIABLES: readonly ConsultantContractToken[] = [
  'consultant_name',
  'consultant_phone',
  'consultant_email',
  'consultant_position',
  'consultant_address',
  'consultant_city',
  'consultant_id_number',
  'commission_rate',
  'consultant_share',
  'payout_method',
  'payout_details',
  'today',
  'metwork_name',
  'metwork_address',
  'metwork_rc',
  'metwork_nif',
];

const KNOWN_TOKENS = new Set<string>(CONSULTANT_CONTRACT_VARIABLES);

const PAYOUT_METHOD_LABEL_FR: Record<'BANK_TRANSFER' | 'CCP' | 'CHEQUE', string> = {
  BANK_TRANSFER: 'Virement bancaire',
  CCP: 'Virement CCP (Algérie Poste)',
  CHEQUE: 'Chèque',
};

/** "20 %" from 0.2, without floating-point noise. */
function fmtRate(rate: number): string {
  return `${(Math.round(rate * 1000) / 10).toString().replace('.', ',')} %`;
}

function fmtDateFr(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('fr-DZ', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' });
  } catch {
    return iso.slice(0, 10);
  }
}

export interface ResolveConsultantVariablesInput {
  mentor: Pick<
    MentorRecord,
    'fullName' | 'phone' | 'email' | 'position' | 'address' | 'city' | 'idNumber'
  >;
  /** The LIVE resolved rate at the moment of merging — a display value only; the record's own frozen rate is still resolved again at send-time. */
  commissionRate: number;
  payoutMethod: 'BANK_TRANSFER' | 'CCP' | 'CHEQUE';
  /** Same masked description `sendContract` freezes onto the record. */
  payoutDetails: string | null;
  /** Optional — the fields an admin can fill in under Settings. Absent/blank tokens simply render empty. */
  metwork?: Pick<IncubatorRecord, 'name' | 'address' | 'commercialRegNumber' | 'nif'> | null;
}

/** Resolve every token's live value at template-merge time (contract creation). */
export function resolveConsultantContractVariables(
  input: ResolveConsultantVariablesInput,
): Record<ConsultantContractToken, string> {
  const { mentor, commissionRate, payoutMethod, payoutDetails, metwork } = input;
  return {
    consultant_name: mentor.fullName ?? '',
    consultant_phone: mentor.phone ?? '',
    consultant_email: mentor.email ?? '',
    consultant_position: mentor.position ?? '',
    consultant_address: mentor.address ?? '',
    // The picker stores a stable code ('algiers'); the contract is French and
    // must print the wilaya NAME. Legacy free-text values pass through as typed.
    consultant_city: formatCityLabel(mentor.city, 'fr'),
    consultant_id_number: mentor.idNumber ?? '',
    commission_rate: fmtRate(commissionRate),
    consultant_share: fmtRate(1 - commissionRate),
    payout_method: PAYOUT_METHOD_LABEL_FR[payoutMethod],
    payout_details: payoutDetails ?? '',
    today: fmtDateFr(new Date().toISOString()),
    metwork_name: metwork?.name ?? '',
    metwork_address: metwork?.address ?? '',
    metwork_rc: metwork?.commercialRegNumber ?? '',
    metwork_nif: metwork?.nif ?? '',
  };
}

/**
 * Layout marker letting an admin choose WHERE the signature + stamp block lands
 * in the document. Deliberately NOT one of the tokens above: those substitute
 * text, this positions images, so it is handled by the PDF renderer and must
 * survive `renderConsultantContractTemplate` untouched (hence it is absent from
 * KNOWN_TOKENS — unknown tokens are stripped, which would defeat it... so it is
 * explicitly preserved in the replacer below).
 *
 * Lives HERE rather than in `contract-pdf.ts` because the on-screen previews
 * (admin queue + consultant portal) are client components that cannot import
 * the pdfkit renderer, and all three surfaces must agree on one definition.
 *
 * Absent ⇒ the block goes at the end, exactly as before.
 */
export const SIGNATURE_MARKER = '{{signature_block}}';
const SIGNATURE_MARKER_SOURCE = '\\{\\{\\s*signature_block\\s*\\}\\}';
export const SIGNATURE_MARKER_RE = new RegExp(SIGNATURE_MARKER_SOURCE);

/**
 * Split a body into the text before and after the marker. No marker ⇒
 * everything is "before", so the block appends at the end. Only the FIRST
 * occurrence positions the block; any further ones are stripped, since two
 * signature blocks is never what an admin means.
 */
export function splitAtSignatureMarker(body: string): [before: string, after: string] {
  const match = SIGNATURE_MARKER_RE.exec(body);
  if (!match) return [body, ''];
  const before = body.slice(0, match.index).trimEnd();
  const after = body.slice(match.index + match[0].length).trimStart();
  return [before, stripSignatureMarker(after).trimStart()];
}

/**
 * Remove every marker from a body — what the on-screen previews render, so the
 * reader never sees a raw `{{signature_block}}` in what is presented as the
 * final legal text.
 */
export function stripSignatureMarker(body: string): string {
  return body.replace(new RegExp(SIGNATURE_MARKER_SOURCE, 'g'), '');
}

const TOKEN_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/**
 * Fill `{{tokens}}` in a template body. Only whitelisted tokens are
 * substituted; any unknown placeholder — a typo, or a space-booking token
 * pasted in by mistake — is replaced with an empty string.
 */
export function renderConsultantContractTemplate(
  body: string,
  values: Partial<Record<string, string>>,
): string {
  return body.replace(TOKEN_RE, (match, token: string) => {
    // The layout marker is not a value token — leave it in place for the PDF
    // renderer, which consumes it after this merge.
    if (token === 'signature_block') return match;
    if (!KNOWN_TOKENS.has(token)) return '';
    return values[token] ?? '';
  });
}

/**
 * Infer the payout method from the consultant's own account, so contract
 * creation never asks the admin something the consultant's profile already
 * answers. Falls back to BANK_TRANSFER (the most common case) when no
 * account is on file yet — the admin can still correct it via edit.
 */
export function inferPayoutMethod(
  mentor: Pick<MentorRecord, 'payoutAccount'>,
): 'BANK_TRANSFER' | 'CCP' {
  return mentor.payoutAccount?.accountType === 'ccp' ? 'CCP' : 'BANK_TRANSFER';
}

/**
 * Render a payout account into the one-line description printed on the
 * contract (also what `{{payout_details}}` resolves to). The account number
 * is masked to its last 4 digits: the contract must identify the account
 * unambiguously to its holder without turning every copy of the PDF into a
 * full set of bank details.
 */
export function describePayoutAccount(mentor: Pick<MentorRecord, 'payoutAccount'>): string | null {
  const account = mentor.payoutAccount;
  if (!account?.accountNumber) return null;
  const digits = account.accountNumber.replace(/\s+/g, '');
  const masked = digits.length > 4 ? `${'•'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}` : digits;
  const label = account.accountType === 'ccp' ? 'CCP' : 'RIB';
  return `${label} ${masked} — ${account.holderName}`;
}
