/**
 * Deleting a cancelled document — ONE implementation for incubators,
 * consultants and freelancers.
 *
 * A facture, proforma or devis is never deleted while it is live: it must be
 * cancelled first. Deleting is the second, deliberate step, and it exists so an
 * issuer can replace a document they cancelled — including re-using its number.
 *
 *   - The number is freed. If it was the LAST one issued in its series the
 *     counter steps back, so the next automatic number is that one again; if it
 *     sits in the middle of the series (02/2026 while 13/2026 exists) the
 *     counter is untouched and the free number is re-used by typing it into the
 *     form's "Numéro" field (the create route already accepts a requested
 *     number and refuses a collision).
 *   - A facture converted from a proforma gives that proforma back: the
 *     conversion lock is cleared so it can be edited or converted again.
 *   - Everything is one `db.update()`. The deletion is written to the audit log
 *     INSIDE it (who, what, the money it carried), and the whole record is moved
 *     to `deletedInvoices`, so nothing is ever lost without a trace and an
 *     admin can recover it.
 *
 * Only the owner can do this (ownership is checked with `ownsInvoice`, which
 * refuses a row carrying a sibling owner id).
 */
import { randomUUID } from 'node:crypto';
import { db, type InvoiceRecord } from '@/server/db/store';
import { counterKey } from '@/server/invoices/engine';
import { findIssuer, ownsInvoice, type InvoiceOwner } from '@/server/invoices/owner';

export interface DeleteActor {
  id: string;
  email: string;
}

export type DeleteInvoiceResult =
  | {
      ok: true;
      /** The number that is free again, e.g. "02/2026". */
      number: string;
      seq: number;
      year: number;
      /** True when the counter stepped back, so the next automatic number is `number`. */
      nextAutomatic: boolean;
      /** The proforma/devis this facture was converted from, unlocked again (null otherwise). */
      releasedSource: InvoiceRecord | null;
    }
  | { ok: false; status: number; code: string; message: string };

export async function deleteCancelledInvoice(
  owner: InvoiceOwner,
  id: string,
  actor: DeleteActor,
): Promise<DeleteInvoiceResult> {
  return db.update<DeleteInvoiceResult>((d) => {
    const invoices = d.invoices ?? [];
    const index = invoices.findIndex((i) => i.id === id && ownsInvoice(i, owner));
    if (index === -1) {
      return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Document introuvable' };
    }
    const invoice = invoices[index]!;
    // Validate everything BEFORE mutating: db.update has no rollback.
    if (invoice.status !== 'CANCELLED') {
      return {
        ok: false,
        status: 409,
        code: 'NOT_CANCELLED',
        message: 'Annulez d’abord ce document : seul un document annulé peut être supprimé.',
      };
    }

    const kind = invoice.kind ?? 'FACTURE';
    const now = new Date().toISOString();

    // Give the number back. Step the counter back only when this was the last
    // one issued; otherwise the series keeps its place.
    let nextAutomatic = false;
    const issuer = findIssuer(d, owner);
    if (issuer) {
      const counters = issuer.counterHolder.invoiceCounters ?? {};
      const key = counterKey(kind, invoice.year);
      if ((counters[key] ?? 0) === invoice.seq) {
        counters[key] = invoice.seq - 1;
        issuer.counterHolder.invoiceCounters = counters;
        issuer.counterHolder.updatedAt = now;
        nextAutomatic = true;
      }
    }

    // A facture converted from a proforma/devis releases its source.
    let releasedSource: InvoiceRecord | null = null;
    if (invoice.convertedFromId) {
      const source = invoices.find((i) => i.id === invoice.convertedFromId && ownsInvoice(i, owner));
      if (source && source.convertedToInvoiceId === invoice.id) {
        delete source.convertedToInvoiceId;
        delete source.convertedToNumber;
        delete source.convertedAt;
        source.updatedAt = now;
        releasedSource = { ...source };
      }
    }

    invoices.splice(index, 1);

    // Keep the whole record: the issuer no longer sees it, an admin can still
    // recover it.
    if (!Array.isArray(d.deletedInvoices)) d.deletedInvoices = [];
    d.deletedInvoices.push({ deletedAt: now, deletedById: actor.id, invoice: { ...invoice } });

    if (!Array.isArray(d.auditLogs)) d.auditLogs = [];
    d.auditLogs.push({
      id: randomUUID(),
      adminId: actor.id,
      adminEmail: actor.email,
      action: 'INVOICE_DELETED',
      targetType: 'invoice',
      targetId: invoice.id,
      details: {
        ownerType: owner.type,
        ownerId: owner.id,
        number: invoice.number,
        kind,
        issuedAt: invoice.issuedAt,
        client: invoice.clientSnapshot.legalName ?? invoice.clientSnapshot.name,
        ttc: invoice.totals.ttc,
        net: invoice.totals.net,
        counterSteppedBack: nextAutomatic,
      },
      createdAt: now,
    });
    if (d.auditLogs.length > 2_000) d.auditLogs = d.auditLogs.slice(-2_000);

    return { ok: true, number: invoice.number, seq: invoice.seq, year: invoice.year, nextAutomatic, releasedSource };
  });
}
