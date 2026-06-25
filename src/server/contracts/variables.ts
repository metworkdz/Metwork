/**
 * Contract template variable engine — the single source of truth for the
 * whitelisted `{{tokens}}` a contract body may contain.
 *
 * Used by BOTH:
 *  - the generation endpoint (resolves real values from booking/client/incubator)
 *  - the templates UI (variable-reference panel + live sample preview)
 *
 * Rendering is whitelist-driven and pure string replacement — there is no eval
 * and unknown placeholders resolve to an empty string, so a malformed template
 * can never crash generation.
 */
import type {
  BookingRecord,
  IncubatorRecord,
  SpaceRecord,
  UserRecord,
} from '@/server/db/store';

export type ContractLang = 'fr' | 'en' | 'ar';

/** Every token the engine understands. Anything else renders blank. */
export type ContractVariableToken =
  | 'client_name'
  | 'client_phone'
  | 'client_email'
  | 'client_id_number'
  | 'space_name'
  | 'space_category'
  | 'start_date'
  | 'start_time'
  | 'end_date'
  | 'end_time'
  | 'duration'
  | 'price'
  | 'amount_paid'
  | 'amount_due'
  | 'incubator_name'
  | 'incubator_address'
  | 'incubator_cr'
  | 'incubator_nif'
  | 'today'
  | 'contract_number';

/**
 * Ordered token catalogue. `descriptionKey` maps to an i18n key under
 * `incubator.contracts.vars.*` so the reference panel is fully localized.
 */
export const CONTRACT_VARIABLES: { token: ContractVariableToken; descriptionKey: string }[] = [
  { token: 'client_name',       descriptionKey: 'clientName' },
  { token: 'client_phone',      descriptionKey: 'clientPhone' },
  { token: 'client_email',      descriptionKey: 'clientEmail' },
  { token: 'client_id_number',  descriptionKey: 'clientIdNumber' },
  { token: 'space_name',        descriptionKey: 'spaceName' },
  { token: 'space_category',    descriptionKey: 'spaceCategory' },
  { token: 'start_date',        descriptionKey: 'startDate' },
  { token: 'start_time',        descriptionKey: 'startTime' },
  { token: 'end_date',          descriptionKey: 'endDate' },
  { token: 'end_time',          descriptionKey: 'endTime' },
  { token: 'duration',          descriptionKey: 'duration' },
  { token: 'price',             descriptionKey: 'price' },
  { token: 'amount_paid',       descriptionKey: 'amountPaid' },
  { token: 'amount_due',        descriptionKey: 'amountDue' },
  { token: 'incubator_name',    descriptionKey: 'incubatorName' },
  { token: 'incubator_address', descriptionKey: 'incubatorAddress' },
  { token: 'incubator_cr',      descriptionKey: 'incubatorCr' },
  { token: 'incubator_nif',     descriptionKey: 'incubatorNif' },
  { token: 'today',             descriptionKey: 'today' },
  { token: 'contract_number',   descriptionKey: 'contractNumber' },
];

const KNOWN_TOKENS = new Set<string>(CONTRACT_VARIABLES.map((v) => v.token));

/* ─────────────────── locale helpers ─────────────────── */

const INTL_LOCALE: Record<ContractLang, string> = {
  fr: 'fr-DZ',
  en: 'en-GB',
  ar: 'ar-DZ',
};

/** Per-language billing-unit words used by the {{duration}} token. */
const UNIT_WORDS: Record<ContractLang, Record<BookingRecord['unit'], string>> = {
  fr: { HOUR: 'heure(s)', HALF_DAY: 'demi-journée(s)', DAY: 'jour(s)', MONTH: 'mois' },
  en: { HOUR: 'hour(s)',  HALF_DAY: 'half-day(s)',     DAY: 'day(s)',  MONTH: 'month(s)' },
  ar: { HOUR: 'ساعة',     HALF_DAY: 'نصف يوم',          DAY: 'يوم',     MONTH: 'شهر' },
};

const CATEGORY_WORDS: Record<ContractLang, Record<SpaceRecord['category'], string>> = {
  fr: { COWORKING: 'Espace de coworking', PRIVATE_OFFICE: 'Bureau privé', TRAINING_ROOM: 'Salle de formation', DOMICILIATION: 'Domiciliation' },
  en: { COWORKING: 'Coworking space',     PRIVATE_OFFICE: 'Private office', TRAINING_ROOM: 'Training room',     DOMICILIATION: 'Domiciliation' },
  ar: { COWORKING: 'مساحة عمل مشتركة',     PRIVATE_OFFICE: 'مكتب خاص',       TRAINING_ROOM: 'قاعة تدريب',        DOMICILIATION: 'توطين' },
};

function fmtMoney(n: number): string {
  // Grouping matches the platform receipts (fr-DZ), with an explicit DZD suffix.
  return `${Math.round(n).toLocaleString('fr-DZ')} DZD`;
}

function fmtDateOnly(iso: string, lang: ContractLang): string {
  try {
    return new Date(iso).toLocaleDateString(INTL_LOCALE[lang], {
      day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC',
    });
  } catch {
    return iso.slice(0, 10);
  }
}

function fmtTimeOnly(iso: string, lang: ContractLang): string {
  try {
    return new Date(iso).toLocaleTimeString(INTL_LOCALE[lang], {
      hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
    });
  } catch {
    return iso.slice(11, 16);
  }
}

/* ─────────────────── contract number ─────────────────── */

/**
 * Stable, unique contract number for a (booking) pair. Deterministic from the
 * booking id so re-downloading the same booking's contract yields the same
 * number; the booking id slice guarantees global uniqueness.
 */
export function generateContractNumber(incubator: Pick<IncubatorRecord, 'name' | 'id'>, booking: Pick<BookingRecord, 'id'>): string {
  const incToken = (incubator.name || incubator.id)
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 4)
    .toUpperCase() || 'INC';
  return `CT-${incToken}-${booking.id.slice(0, 8).toUpperCase()}`;
}

/* ─────────────────── resolution ─────────────────── */

export interface ResolveContext {
  booking: BookingRecord;
  /** The space the booking is for (looked up by booking.itemId). May be null. */
  space: SpaceRecord | null;
  incubator: IncubatorRecord;
  /** Resolved platform user for online bookings; null for offline/guest. */
  user: UserRecord | null;
  lang: ContractLang;
  contractNumber: string;
}

/**
 * Resolve every whitelisted variable to its display string. Values are pulled
 * from the booking, the resolved user (online bookings), the space and the
 * incubator — nothing here requires the incubator to re-enter data.
 */
export function resolveContractVariables(ctx: ResolveContext): Record<ContractVariableToken, string> {
  const { booking, space, incubator, user, lang, contractNumber } = ctx;

  const category = space?.category ?? null;

  // amount_paid / amount_due: card CASH_DEPOSIT bookings carry an explicit
  // online/cash split; everything else is treated as paid-in-full.
  const isCashDeposit = booking.paymentMode === 'CASH_DEPOSIT';
  const amountPaid = isCashDeposit
    ? booking.onlinePaidAmount ?? 0
    : booking.onlinePaidAmount ?? booking.totalAmount;
  const amountDue = isCashDeposit ? booking.cashRemainingAmount ?? 0 : 0;

  return {
    client_name:       user?.fullName ?? booking.clientName ?? '',
    client_phone:      user?.phone ?? booking.clientPhone ?? '',
    client_email:      user?.email ?? booking.clientEmail ?? '',
    client_id_number:  booking.clientIdNumber ?? '',
    space_name:        booking.itemName ?? space?.name ?? '',
    space_category:    category ? CATEGORY_WORDS[lang][category] : '',
    start_date:        fmtDateOnly(booking.startsAt, lang),
    start_time:        fmtTimeOnly(booking.startsAt, lang),
    end_date:          fmtDateOnly(booking.endsAt, lang),
    end_time:          fmtTimeOnly(booking.endsAt, lang),
    duration:          `${booking.quantity} ${UNIT_WORDS[lang][booking.unit]}`,
    price:             fmtMoney(booking.totalAmount),
    amount_paid:       fmtMoney(amountPaid),
    amount_due:        fmtMoney(amountDue),
    incubator_name:    incubator.name ?? '',
    incubator_address: incubator.address ?? '',
    // The profile form edits `commercialRegNumber`; legacy records may only
    // carry `registrationNumber` (the receipt's RC line) — accept either.
    incubator_cr:      incubator.commercialRegNumber ?? incubator.registrationNumber ?? '',
    incubator_nif:     incubator.nif ?? '',
    today:             fmtDateOnly(new Date().toISOString(), lang),
    contract_number:   contractNumber,
  };
}

/* ─────────────────── rendering ─────────────────── */

const TOKEN_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/**
 * Fill `{{tokens}}` in a template body. Only whitelisted tokens are substituted;
 * any unknown placeholder is replaced with an empty string so a malformed
 * template renders safely and never throws.
 */
export function renderTemplate(body: string, values: Partial<Record<string, string>>): string {
  return body.replace(TOKEN_RE, (_match, token: string) => {
    if (!KNOWN_TOKENS.has(token)) return '';
    return values[token] ?? '';
  });
}

/* ─────────────────── sample data (UI preview) ─────────────────── */

/**
 * Representative sample values for the live preview in the templates editor —
 * lets the incubator see a filled contract without a real booking.
 */
export function buildSampleVariables(lang: ContractLang): Record<ContractVariableToken, string> {
  const cat: SpaceRecord['category'] = 'TRAINING_ROOM';
  return {
    client_name:       lang === 'ar' ? 'أحمد بن علي' : 'Ahmed Benali',
    client_phone:      '+213 555 12 34 56',
    client_email:      'ahmed.benali@example.dz',
    client_id_number:  '1234567890',
    space_name:        lang === 'ar' ? 'قاعة التدريب أ' : 'Training Room A',
    space_category:    CATEGORY_WORDS[lang][cat],
    start_date:        fmtDateOnly(new Date().toISOString(), lang),
    start_time:        '09:00',
    end_date:          fmtDateOnly(new Date(Date.now() + 86400000).toISOString(), lang),
    end_time:          '17:00',
    duration:          `2 ${UNIT_WORDS[lang].DAY}`,
    price:             fmtMoney(24000),
    amount_paid:       fmtMoney(12000),
    amount_due:        fmtMoney(12000),
    incubator_name:    lang === 'ar' ? 'حاضنة الجزائر' : 'Algiers Incubator',
    incubator_address: lang === 'ar' ? '12 شارع ديدوش مراد، الجزائر' : '12 Rue Didouche Mourad, Algiers',
    incubator_cr:      'RC-16/00-1234567',
    incubator_nif:     '0987654321098',
    today:             fmtDateOnly(new Date().toISOString(), lang),
    contract_number:   'CT-ALGI-A1B2C3D4',
  };
}
