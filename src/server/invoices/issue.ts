/**
 * Issuing a document — one implementation, two issuers.
 *
 * The incubator and consultant routes differ only in how they authenticate and
 * whose id they resolve; everything after that (validation, the legal gate, the
 * recipient snapshot, number allocation, the totals) is identical and lives
 * here. Splitting it would mean two sets of rules about what a valid Algerian
 * invoice is, and they would drift.
 *
 * The whole write is ONE `db.update()`: the number is allocated and the record
 * appended inside the store's serialized write queue, which is what stops two
 * concurrent creates from colliding or skipping a number.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db, type ClientRecord, type InvoiceRecord } from '@/server/db/store';
import {
  allocateInvoiceNumber,
  amountToFrenchWords,
  computeInvoiceTotals,
  formatInvoiceNumber,
} from '@/server/invoices/engine';
import {
  findIssuer,
  issuerLegalGate,
  issuerSnapshotFrom,
  ownerFields,
  ownsClient,
  ownsInvoice,
  type InvoiceOwner,
} from '@/server/invoices/owner';

/* ─────────────────── Input ─────────────────── */

const lineSchema = z.object({
  designation: z.string().min(1).max(300),
  quantity: z.number().positive().max(1_000_000),
  unitPriceHt: z.number().min(0).max(1_000_000_000),
});

/** Ad-hoc recipient when the document isn't linked to a saved client. */
const clientDraftSchema = z.object({
  clientType: z.enum(['COMPANY', 'INDIVIDUAL']),
  name: z.string().min(1).max(160),
  legalName: z.string().max(200).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  rc: z.string().max(100).optional().nullable(),
  nif: z.string().max(100).optional().nullable(),
  nis: z.string().max(100).optional().nullable(),
  ai: z.string().max(100).optional().nullable(),
  phone: z.string().max(30).optional().nullable(),
  email: z.string().email().max(200).optional().nullable(),
});

export const issueInvoiceSchema = z
  .object({
    clientId: z.string().min(1).optional(),
    clientDraft: clientDraftSchema.optional(),
    lines: z.array(lineSchema).min(1).max(100),
    vatRate: z.number().min(0).max(100).optional(),
    paymentMethod: z.enum(['ESPECE', 'CHEQUE', 'VIREMENT']),
    template: z.enum(['CLASSIC', 'GREEN_BAND', 'MINIMAL']).optional(),
    /** Which document to issue. Absent = FACTURE, as it always was. */
    kind: z.enum(['FACTURE', 'PROFORMA', 'DEVIS']).optional(),
    /** Offer expiry, "YYYY-MM-DD". Required on a DEVIS (see the refine below). */
    validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
    /** Print the issuer's stamp on this document. Per document on purpose. */
    withStamp: z.boolean().optional(),
    /** Free text printed at the bottom of this one document. */
    note: z.string().trim().max(600).optional().nullable(),
    /**
     * Number override / custom starting range, e.g. 9 → "09/2026". An issuer
     * arriving with documents already numbered elsewhere starts their sequence
     * where their own books left off; the counter then continues from there.
     */
    seq: z.number().int().positive().max(999_999).optional(),
  })
  .refine((v) => v.clientId || v.clientDraft, {
    message: 'Provide clientId or clientDraft',
    path: ['clientId'],
  })
  .refine((v) => v.kind !== 'DEVIS' || !!v.validUntil, {
    // A quote with no end date is an open-ended commitment to that price.
    message: 'Un devis doit avoir une date de validité',
    path: ['validUntil'],
  });

export type IssueInvoiceInput = z.infer<typeof issueInvoiceSchema>;

export type IssueInvoiceResult =
  | { ok: true; invoice: InvoiceRecord }
  | { ok: false; status: number; code: string; message: string };

/* ─────────────────── Snapshot helpers ─────────────────── */

function clientSnapshotFrom(c: ClientRecord): InvoiceRecord['clientSnapshot'] {
  return {
    clientType: c.clientType ?? (c.companyName ? 'COMPANY' : 'INDIVIDUAL'),
    name: c.fullName,
    legalName: c.legalName ?? c.companyName ?? null,
    address: c.address ?? null,
    rc: c.rc ?? null,
    nif: c.nif ?? null,
    nis: c.nis ?? null,
    ai: c.ai ?? null,
    phone: c.phone || null,
    email: c.email || null,
  };
}

/* ─────────────────── Issue ─────────────────── */

export async function issueInvoice(
  owner: InvoiceOwner,
  input: IssueInvoiceInput,
): Promise<IssueInvoiceResult> {
  // The letterhead is read once OUTSIDE the transaction to run the legal gate
  // and resolve defaults; it is read again inside, because the snapshot must
  // come from the same view of the store the number is allocated from.
  const pre = findIssuer(await db.read(), owner);
  if (!pre) {
    return { ok: false, status: 404, code: 'ISSUER_NOT_FOUND', message: 'Issuer not found' };
  }

  const gate = issuerLegalGate(pre.profile, input.paymentMethod, owner);
  if (!gate.ok) return { ok: false, status: 422, code: gate.code, message: gate.message };

  const vatRate = input.vatRate ?? pre.profile.defaultVatRate;
  const template = input.template ?? pre.profile.invoiceTemplate;
  const now = new Date().toISOString();
  const year = new Date().getUTCFullYear();
  const kind = input.kind ?? 'FACTURE';

  return db.update<IssueInvoiceResult>((d) => {
    const issuer = findIssuer(d, owner);
    if (!issuer) {
      return { ok: false, status: 404, code: 'ISSUER_NOT_FOUND', message: 'Issuer not found' };
    }

    // Resolve the recipient inside the transaction so a concurrent client edit
    // can't slip between read and snapshot.
    let clientSnapshot: InvoiceRecord['clientSnapshot'];
    let clientId: string | null = null;
    if (input.clientId) {
      const client = (d.clients ?? []).find((c) => c.id === input.clientId && ownsClient(c, owner));
      if (!client) {
        return { ok: false, status: 404, code: 'CLIENT_NOT_FOUND', message: 'Client not found' };
      }
      clientId = client.id;
      clientSnapshot = clientSnapshotFrom(client);
    } else {
      const draft = input.clientDraft!;
      clientSnapshot = {
        clientType: draft.clientType,
        name: draft.name,
        legalName: draft.legalName ?? null,
        address: draft.address ?? null,
        rc: draft.rc ?? null,
        nif: draft.nif ?? null,
        nis: draft.nis ?? null,
        ai: draft.ai ?? null,
        phone: draft.phone ?? null,
        email: draft.email ?? null,
      };
    }

    if (!Array.isArray(d.invoices)) d.invoices = [];

    // A requested number must not collide — within this ISSUER and this KIND.
    // "01/2026" and "FP 01/2026" are different documents and may both exist,
    // and so may an incubator's 01/2026 and a consultant's.
    if (
      input.seq !== undefined &&
      d.invoices.some(
        (i) =>
          ownsInvoice(i, owner) &&
          i.year === year &&
          i.seq === input.seq &&
          (i.kind ?? 'FACTURE') === kind,
      )
    ) {
      return {
        ok: false,
        status: 409,
        code: 'NUMBER_TAKEN',
        message: `Le numéro ${formatInvoiceNumber(input.seq, year, kind)} est déjà utilisé`,
      };
    }

    const { number, seq } = allocateInvoiceNumber(issuer.counterHolder, year, input.seq, kind);
    issuer.counterHolder.updatedAt = now;
    const totals = computeInvoiceTotals(input.lines, vatRate, input.paymentMethod, kind);

    const invoice: InvoiceRecord = {
      id: randomUUID(),
      ...ownerFields(owner),
      kind,
      number,
      year,
      seq,
      validUntil: input.validUntil ?? null,
      issuedAt: now,
      clientId,
      clientSnapshot,
      issuerSnapshot: issuerSnapshotFrom(issuer.profile),
      lines: input.lines,
      withStamp: input.withStamp ?? false,
      note: input.note?.trim() || null,
      vatRate,
      paymentMethod: input.paymentMethod,
      template,
      totals,
      amountInWords: amountToFrenchWords(totals.net),
      status: 'ISSUED',
      createdAt: now,
      updatedAt: now,
    };

    d.invoices.push(invoice);
    return { ok: true, invoice };
  });
}
