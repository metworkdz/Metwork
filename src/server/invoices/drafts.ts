/**
 * Proformas and devis are drafts of a sale, not accounting records — each one
 * says so on its face. So, unlike a facture, they can be corrected in place
 * (same number) and have their stamp added or removed. A facture never: its
 * correction path stays cancel + reissue.
 *
 * One implementation for both issuers (incubator dashboard, consultant
 * portal); the route files only resolve the owner. Every refusal comes before
 * the first write — `db.update` persists the draft whatever it returns.
 */
import { z } from 'zod';

import { db, type InvoiceRecord } from '@/server/db/store';
import { amountToFrenchWords, computeInvoiceTotals } from '@/server/invoices/engine';
import {
  findIssuer,
  issuerLegalGate,
  issuerSnapshotFrom,
  ownsInvoice,
  type InvoiceOwner,
} from '@/server/invoices/owner';
import { invoiceFieldsSchema, resolveRecipient } from '@/server/invoices/issue';

export type DraftRefusal = { ok: false; status: number; code: string; message: string };

/** Why a document cannot be changed, or null when it can. */
export function draftLock(invoice: InvoiceRecord): DraftRefusal | null {
  const kind = invoice.kind ?? 'FACTURE';
  if (kind === 'FACTURE') {
    return { ok: false, status: 409, code: 'FACTURE_LOCKED', message: 'Une facture émise ne se modifie pas : annulez-la et émettez-en une nouvelle.' };
  }
  if (invoice.status === 'CANCELLED') {
    return { ok: false, status: 409, code: 'CANCELLED', message: 'Ce document est annulé.' };
  }
  if (invoice.convertedToInvoiceId) {
    return { ok: false, status: 409, code: 'CONVERTED', message: 'Ce document a déjà été converti en facture.' };
  }
  return null;
}

/** What an edit may change: everything but the kind and the number. */
export const editDraftSchema = invoiceFieldsSchema
  .omit({ kind: true, seq: true })
  .refine((v) => v.clientId || v.clientDraft, { message: 'Provide clientId or clientDraft', path: ['clientId'] });

export type EditDraftInput = z.infer<typeof editDraftSchema>;
export type DraftResult = { ok: true; invoice: InvoiceRecord } | DraftRefusal;

const notFound: DraftRefusal = { ok: false, status: 404, code: 'NOT_FOUND', message: 'Document introuvable' };

/**
 * Rewrite a proforma or devis. The number and issue date stay; the client and
 * letterhead are re-read NOW (a client completed since shows up), and the
 * totals and amount in words are recomputed by the same engine as at issue.
 */
export async function editDraftDocument(owner: InvoiceOwner, id: string, input: EditDraftInput): Promise<DraftResult> {
  const pre = findIssuer(await db.read(), owner);
  if (!pre) return { ok: false, status: 404, code: 'ISSUER_NOT_FOUND', message: 'Issuer not found' };
  const gate = issuerLegalGate(pre.profile, input.paymentMethod, owner);
  if (!gate.ok) return { ok: false, status: 422, code: gate.code, message: gate.message };

  return db.update<DraftResult>((d) => {
    const invoice = (d.invoices ?? []).find((i) => i.id === id && ownsInvoice(i, owner));
    if (!invoice) return notFound;
    const lock = draftLock(invoice);
    if (lock) return lock;
    const kind = invoice.kind!;
    if (kind === 'DEVIS' && !input.validUntil) {
      return { ok: false, status: 422, code: 'VALID_UNTIL_REQUIRED', message: 'Un devis doit avoir une date de validité' };
    }
    const issuer = findIssuer(d, owner);
    if (!issuer) return { ok: false, status: 404, code: 'ISSUER_NOT_FOUND', message: 'Issuer not found' };
    const recipient = resolveRecipient(d, owner, input);
    if (!recipient) return { ok: false, status: 404, code: 'CLIENT_NOT_FOUND', message: 'Client not found' };

    const vatRate = input.vatRate ?? invoice.vatRate;
    const totals = computeInvoiceTotals(input.lines, vatRate, input.paymentMethod, kind);
    const now = new Date().toISOString();
    Object.assign(invoice, {
      clientId: recipient.clientId,
      clientSnapshot: recipient.clientSnapshot,
      issuerSnapshot: issuerSnapshotFrom(issuer.profile),
      lines: input.lines,
      vatRate,
      paymentMethod: input.paymentMethod,
      template: input.template ?? invoice.template,
      validUntil: input.validUntil ?? null,
      withStamp: input.withStamp ?? false,
      note: input.note?.trim() || null,
      totals,
      amountInWords: amountToFrenchWords(totals.net),
      editedAt: now,
      updatedAt: now,
    } satisfies Partial<InvoiceRecord>);
    return { ok: true, invoice: { ...invoice } };
  });
}

/** Add or remove the stamp on a proforma or devis — one click in the list. */
export async function setDraftStamp(owner: InvoiceOwner, id: string, withStamp: boolean): Promise<DraftResult> {
  return db.update<DraftResult>((d) => {
    const invoice = (d.invoices ?? []).find((i) => i.id === id && ownsInvoice(i, owner));
    if (!invoice) return notFound;
    const lock = draftLock(invoice);
    if (lock) return lock;
    if (withStamp && !findIssuer(d, owner)?.profile.stampUrl) {
      return { ok: false, status: 422, code: 'NO_STAMP', message: 'Aucun cachet enregistré : ajoutez-le dans Paramètres.' };
    }
    const now = new Date().toISOString();
    invoice.withStamp = withStamp;
    // The stamp printed is the CURRENT one, the same as a fresh document.
    if (withStamp) invoice.issuerSnapshot = { ...invoice.issuerSnapshot, stampUrl: findIssuer(d, owner)!.profile.stampUrl ?? null };
    invoice.editedAt = now;
    invoice.updatedAt = now;
    return { ok: true, invoice: { ...invoice } };
  });
}
