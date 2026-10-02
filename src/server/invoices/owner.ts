/**
 * Who issued a document — the ONE place that knows an invoice can belong to an
 * incubator or to a consultant.
 *
 * `InvoiceRecord` and `ClientRecord` each carry two optional owner ids and
 * exactly one of them is ever set. Spreading `i.incubatorId === x` across
 * routes is how that invariant rots, so every ownership question goes through
 * this module: who owns this document, which clients may it be addressed to,
 * which counter does its number come from, and is the issuer's letterhead
 * legally complete. Nothing was migrated — every document issued before
 * consultants could invoice carries `incubatorId`, and reads as an incubator's.
 *
 * Mirrors `src/server/withdrawals/service.ts`, which already serves the two
 * parallel ledgers from one implementation.
 */
import { peekNextSeq } from '@/server/invoices/engine';
import type {
  ClientRecord,
  IncubatorRecord,
  InvoiceKind,
  InvoiceRecord,
  InvoiceTemplate,
  InvoicePaymentMethod,
  MentorRecord,
} from '@/server/db/store';

export type InvoiceOwnerType = 'INCUBATOR' | 'CONSULTANT';

export interface InvoiceOwner {
  type: InvoiceOwnerType;
  /** IncubatorRecord.id or MentorRecord.id. */
  id: string;
}

/** The slice of the store this module reads. Accepts a draft or a snapshot. */
export interface InvoiceStoreSlice {
  incubators?: IncubatorRecord[];
  mentors?: MentorRecord[];
  invoices?: InvoiceRecord[];
  clients?: ClientRecord[];
}

/* ─────────────────── Ownership ─────────────────── */

/** The owner fields to WRITE on a new invoice or client. Exactly one is set. */
export function ownerFields(owner: InvoiceOwner): { incubatorId?: string; mentorId?: string } {
  return owner.type === 'INCUBATOR' ? { incubatorId: owner.id } : { mentorId: owner.id };
}

function ownedBy(rec: { incubatorId?: string | null; mentorId?: string | null }, owner: InvoiceOwner): boolean {
  return owner.type === 'INCUBATOR' ? rec.incubatorId === owner.id : rec.mentorId === owner.id;
}

export function ownsInvoice(invoice: InvoiceRecord, owner: InvoiceOwner): boolean {
  return ownedBy(invoice, owner);
}

export function ownsClient(client: ClientRecord, owner: InvoiceOwner): boolean {
  return ownedBy(client, owner);
}

/** This owner's documents, newest first. */
export function invoicesFor(d: InvoiceStoreSlice, owner: InvoiceOwner): InvoiceRecord[] {
  return (d.invoices ?? [])
    .filter((i) => ownsInvoice(i, owner))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** This owner's client book. A consultant never sees an incubator's clients. */
export function clientsFor(d: InvoiceStoreSlice, owner: InvoiceOwner): ClientRecord[] {
  return (d.clients ?? []).filter((c) => ownsClient(c, owner));
}

/* ─────────────────── Issuer letterhead ─────────────────── */

/**
 * The issuer's letterhead, normalised across the two record shapes so the
 * snapshot builder and the legal gate never branch on who is invoicing.
 */
export interface IssuerProfile {
  name: string;
  /**
   * Set only for a consultant on a registre de commerce — it decides the VAT
   * default and is what the settings screen asks for. Null for an incubator
   * (always au réel) and for an auto-entrepreneur.
   */
  rcType?: 'PERSONNE_PHYSIQUE' | 'PERSONNE_MORALE' | null;
  address: string | null;
  /** Registre de Commerce, or a carte d'auto-entrepreneur number. */
  reg: string | null;
  /** What the PDF header calls that number. */
  regLabel: string;
  nif: string | null;
  nis: string | null;
  ai: string | null;
  logoUrl: string | null;
  stampUrl: string | null;
  website: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  bankName: string | null;
  bankRib: string | null;
  defaultVatRate: number;
  invoiceTemplate: InvoiceTemplate;
}

/**
 * The record a number is drawn from — an incubator or a consultant. Only the
 * counters are read or written; `updatedAt` is touched so issuing a document
 * still marks the issuer record as changed, exactly as it did before.
 */
export interface CounterHolder {
  invoiceCounters?: Record<string, number> | null;
  updatedAt?: string;
}

/** Header label for a consultant's registration number. */
export const REG_LABEL_AUTO_ENTREPRENEUR = 'Carte AE';
export const REG_LABEL_REGISTRE_COMMERCE = 'RCN';

/**
 * The VAT a new document starts at.
 *
 * An auto-entrepreneur under the IFU regime does not charge VAT, so their
 * documents default to 0 — and a 0 rate makes the PDF omit the TVA line
 * entirely rather than print "0,00 DA". They can still set a rate if they are
 * assujetti; this is only the default.
 */
export const DEFAULT_VAT_RATE = 19;

const nz = (v: string | null | undefined): string | null => {
  const t = (v ?? '').trim();
  return t ? t : null;
};

/**
 * Resolve the issuer record + its letterhead. Returns null when the owner does
 * not exist, which a caller answers as 404.
 *
 * `counterHolder` is the record whose `invoiceCounters` the number comes from —
 * handed to `allocateInvoiceNumber` inside the same transaction.
 */
export function findIssuer(
  d: InvoiceStoreSlice,
  owner: InvoiceOwner,
): { profile: IssuerProfile; counterHolder: CounterHolder } | null {
  if (owner.type === 'INCUBATOR') {
    const inc = (d.incubators ?? []).find((i) => i.id === owner.id);
    if (!inc) return null;
    return {
      counterHolder: inc,
      profile: {
        name: inc.name,
        address: nz(inc.address),
        // The profile form writes `commercialRegNumber`; legacy records may
        // only carry `registrationNumber` (the receipt's RC line).
        reg: nz(inc.commercialRegNumber) ?? nz(inc.registrationNumber),
        regLabel: REG_LABEL_REGISTRE_COMMERCE,
        rcType: null,
        nif: nz(inc.nif),
        nis: nz(inc.nis),
        ai: nz(inc.ai),
        logoUrl: nz(inc.logoUrl),
        stampUrl: nz(inc.stampUrl),
        website: nz(inc.website),
        contactEmail: nz(inc.contactEmail) ?? nz(inc.email),
        contactPhone: nz(inc.contactPhone) ?? nz(inc.phone),
        bankName: nz(inc.bankName),
        bankRib: nz(inc.bankRib),
        defaultVatRate: inc.defaultVatRate ?? DEFAULT_VAT_RATE,
        invoiceTemplate: inc.invoiceTemplate ?? 'CLASSIC',
      },
    };
  }

  const m = (d.mentors ?? []).find((x) => x.id === owner.id);
  if (!m) return null;
  const autoEntrepreneur = m.invoiceLegalStatus === 'AUTO_ENTREPRENEUR';
  // Who is under the IFU: an auto-entrepreneur, and a personne physique on a
  // registre de commerce. Both charge no VAT. Only a personne morale is au
  // réel by default — which is why the RC type has to be asked for.
  const underIfu = autoEntrepreneur || m.invoiceRcType === 'PERSONNE_PHYSIQUE';
  return {
    counterHolder: m,
    profile: {
      name: m.fullName,
      // The consultant's full legal domicile — the same field the contract
      // names them by, not the public `city`.
      address: nz(m.address),
      reg: nz(m.invoiceRegNumber),
      regLabel: autoEntrepreneur ? REG_LABEL_AUTO_ENTREPRENEUR : REG_LABEL_REGISTRE_COMMERCE,
      rcType: autoEntrepreneur ? null : m.invoiceRcType ?? null,
      nif: nz(m.nif),
      nis: nz(m.nis),
      ai: nz(m.ai),
      // Deliberately NOT `imageUrl`: a headshot is not a letterhead, and there
      // is no fallback to Metwork's mark — that would put the platform's
      // identity on a document between the consultant and their own client.
      logoUrl: nz(m.invoiceLogoUrl),
      stampUrl: nz(m.invoiceStampUrl),
      website: null,
      contactEmail: nz(m.email),
      contactPhone: nz(m.phone),
      bankName: nz(m.bankName),
      bankRib: nz(m.bankRib),
      defaultVatRate: m.defaultVatRate ?? (underIfu ? 0 : DEFAULT_VAT_RATE),
      invoiceTemplate: m.invoiceTemplate ?? 'CLASSIC',
    },
  };
}

/* ─────────────────── Legal gate ─────────────────── */

export type IssuerGateResult =
  | { ok: true }
  | { ok: false; code: 'ISSUER_LEGAL_INCOMPLETE' | 'ISSUER_BANK_INCOMPLETE'; message: string };

/**
 * May this issuer put out a document at all?
 *
 * A document without a name, a registration number and a NIF is not a valid
 * Algerian invoice, and a transfer invoice that does not say where to pay is
 * useless to the client. Both messages are French and name where to fix it,
 * because they are shown to the issuer verbatim.
 */
export function issuerLegalGate(
  profile: IssuerProfile,
  paymentMethod: InvoicePaymentMethod,
  owner: InvoiceOwner,
): IssuerGateResult {
  const settingsHint =
    owner.type === 'CONSULTANT'
      ? 'Facturation → Informations légales'
      : 'Paramètres';

  if (!profile.name?.trim() || !profile.reg || !profile.nif) {
    return {
      ok: false,
      code: 'ISSUER_LEGAL_INCOMPLETE',
      message: `Complétez vos informations légales dans ${settingsHint}`,
    };
  }

  // A consultant on a registre de commerce owes two more things. The TYPE
  // because it decides the tax regime — a personne physique is under the IFU
  // and charges no VAT, a personne morale is au réel — so without it the
  // document cannot know what rate it should have offered. And the article
  // d'imposition, which an RC document carries and a carte d'auto-entrepreneur
  // does not.
  if (owner.type === 'CONSULTANT' && profile.regLabel === REG_LABEL_REGISTRE_COMMERCE) {
    if (!profile.rcType) {
      return {
        ok: false,
        code: 'ISSUER_LEGAL_INCOMPLETE',
        message: `Précisez si vous êtes personne physique ou personne morale dans ${settingsHint}`,
      };
    }
    if (!profile.ai) {
      return {
        ok: false,
        code: 'ISSUER_LEGAL_INCOMPLETE',
        message: `Ajoutez votre article d'imposition dans ${settingsHint}`,
      };
    }
  }
  if (paymentMethod === 'VIREMENT' && !profile.bankRib) {
    return {
      ok: false,
      code: 'ISSUER_BANK_INCOMPLETE',
      message:
        owner.type === 'CONSULTANT'
          ? 'Ajoutez votre RIB dans Facturation → Informations légales pour facturer par virement'
          : 'Ajoutez vos coordonnées bancaires (RIB) dans Paramètres pour facturer par virement',
    };
  }
  return { ok: true };
}

/**
 * What the NEXT document of each kind will be numbered, without consuming
 * anything. The create form shows it as the default so an issuer can override
 * it — allocation still happens inside the write transaction, which is what
 * keeps concurrent creates safe.
 */
export function peekNextSeqFor(
  holder: CounterHolder,
  year: number = new Date().getUTCFullYear(),
): Record<InvoiceKind, number> {
  return {
    FACTURE: peekNextSeq(holder, year, 'FACTURE'),
    PROFORMA: peekNextSeq(holder, year, 'PROFORMA'),
    DEVIS: peekNextSeq(holder, year, 'DEVIS'),
  };
}

/** The frozen issuer block written onto a document at issue time. */
export function issuerSnapshotFrom(profile: IssuerProfile): InvoiceRecord['issuerSnapshot'] {
  return {
    name: profile.name,
    address: profile.address,
    rc: profile.reg,
    rcLabel: profile.regLabel,
    nif: profile.nif,
    nis: profile.nis,
    ai: profile.ai,
    logoUrl: profile.logoUrl,
    website: profile.website,
    contactEmail: profile.contactEmail,
    contactPhone: profile.contactPhone,
    bankName: profile.bankName,
    bankRib: profile.bankRib,
    // Frozen with the rest of the letterhead: changing the stamp in settings
    // must not change a document already issued.
    stampUrl: profile.stampUrl,
  };
}
