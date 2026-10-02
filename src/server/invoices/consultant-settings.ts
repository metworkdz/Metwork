/**
 * A consultant's invoicing identity — the letterhead every document they issue
 * is built from.
 *
 * Kept out of `consultantProfileSchema` on purpose: that schema is deliberately
 * lenient so a partial save of one profile section never 422s on another, which
 * is the wrong contract for fields a legal document depends on. These are
 * edited together, from one screen, and validated as a set.
 */
import { z } from 'zod';
import { db, type MentorRecord } from '@/server/db/store';

export const consultantInvoiceSettingsSchema = z.object({
  /** Which register they are in — decides whether the header says RCN or Carte AE. */
  invoiceLegalStatus: z.enum(['AUTO_ENTREPRENEUR', 'REGISTRE_COMMERCE']).nullable().optional(),
  /**
   * For a registre de commerce: personne physique (IFU, no VAT) or personne
   * morale (au réel). It decides the default rate, so it is asked for, not
   * assumed.
   */
  invoiceRcType: z.enum(['PERSONNE_PHYSIQUE', 'PERSONNE_MORALE']).nullable().optional(),
  /** The carte d'auto-entrepreneur number, or the Registre de Commerce number. */
  invoiceRegNumber: z.string().max(100).nullable().optional(),
  nif: z.string().max(100).nullable().optional(),
  nis: z.string().max(100).nullable().optional(),
  ai: z.string().max(100).nullable().optional(),
  /** Legal domicile — the same field the contract names them by. */
  address: z.string().max(300).nullable().optional(),
  bankName: z.string().max(120).nullable().optional(),
  /** Algerian RIB — 20 digits, spaces tolerated on the way in. */
  bankRib: z.string().max(40).nullable().optional(),
  invoiceTemplate: z.enum(['CLASSIC', 'GREEN_BAND', 'MINIMAL']).nullable().optional(),
  defaultVatRate: z.number().min(0).max(100).nullable().optional(),
  invoiceLogoUrl: z.string().max(500).nullable().optional(),
  invoiceStampUrl: z.string().max(500).nullable().optional(),
});

export type ConsultantInvoiceSettings = z.infer<typeof consultantInvoiceSettingsSchema>;

const trimmed = (v: string | null | undefined): string | null => (v ?? '').trim() || null;

/**
 * Apply only the keys present in the patch, so saving one card never clears
 * another. Returns the updated record, or null when the consultant is gone.
 */
export async function updateConsultantInvoiceSettings(
  mentorId: string,
  patch: ConsultantInvoiceSettings,
): Promise<MentorRecord | null> {
  return db.update<MentorRecord | null>((d) => {
    const m = (d.mentors ?? []).find((x) => x.id === mentorId);
    if (!m) return null;

    // Changing the regime invalidates a rate that was derived from the old
    // one: a consultant who moves from personne morale to personne physique
    // must not keep defaulting to 19 %. An explicit rate on a document is
    // unaffected — this is only the default the form starts from.
    const regimeChanged =
      (patch.invoiceLegalStatus !== undefined && patch.invoiceLegalStatus !== m.invoiceLegalStatus) ||
      (patch.invoiceRcType !== undefined && patch.invoiceRcType !== m.invoiceRcType);
    if (regimeChanged && patch.defaultVatRate === undefined) m.defaultVatRate = null;

    if (patch.invoiceLegalStatus !== undefined) m.invoiceLegalStatus = patch.invoiceLegalStatus;
    if (patch.invoiceRcType !== undefined) m.invoiceRcType = patch.invoiceRcType;
    if (patch.invoiceRegNumber !== undefined) m.invoiceRegNumber = trimmed(patch.invoiceRegNumber);
    if (patch.nif !== undefined) m.nif = trimmed(patch.nif);
    if (patch.nis !== undefined) m.nis = trimmed(patch.nis);
    if (patch.ai !== undefined) m.ai = trimmed(patch.ai);
    if (patch.address !== undefined) m.address = trimmed(patch.address);
    if (patch.bankName !== undefined) m.bankName = trimmed(patch.bankName);
    // Stored without its grouping spaces, like every other RIB in the store.
    if (patch.bankRib !== undefined) {
      m.bankRib = (patch.bankRib ?? '').replace(/\s+/g, '') || null;
    }
    if (patch.invoiceTemplate !== undefined) m.invoiceTemplate = patch.invoiceTemplate;
    if (patch.defaultVatRate !== undefined) m.defaultVatRate = patch.defaultVatRate;
    if (patch.invoiceLogoUrl !== undefined) m.invoiceLogoUrl = trimmed(patch.invoiceLogoUrl);
    if (patch.invoiceStampUrl !== undefined) m.invoiceStampUrl = trimmed(patch.invoiceStampUrl);

    m.updatedAt = new Date().toISOString();
    return m;
  });
}
