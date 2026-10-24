/**
 * HTTP side of editing a proforma/devis — shared by the incubator and
 * consultant `[id]` routes, which only resolve the owner.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';

import { fromZod, json, jsonError } from '@/server/http/json';
import type { InvoiceOwner } from '@/server/invoices/owner';
import { convertDraftToInvoice, editDraftDocument, editDraftSchema, setDraftStamp, type DraftResult } from '@/server/invoices/drafts';

function reply(result: DraftResult) {
  return result.ok ? json({ invoice: result.invoice }) : jsonError(result.status, result.code, result.message);
}

export async function handleEditDraft(req: NextRequest, owner: InvoiceOwner, id: string) {
  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }
  let input;
  try { input = editDraftSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }
  return reply(await editDraftDocument(owner, id, input));
}

export async function handleDraftStamp(owner: InvoiceOwner, id: string, withStamp: boolean) {
  return reply(await setDraftStamp(owner, id, withStamp));
}

const convertSchema = z.object({
  paymentMethod: z.enum(['ESPECE', 'CHEQUE', 'VIREMENT']),
  withStamp: z.boolean(),
  /** The facture's note — prefilled from the proforma, editable, may be cleared. */
  note: z.string().max(600).optional().nullable(),
});

/** POST …/invoices/[id]/convert — returns the new facture and the locked source. */
export async function handleConvertDraft(req: NextRequest, owner: InvoiceOwner, id: string) {
  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }
  let input;
  try { input = convertSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }
  const result = await convertDraftToInvoice(owner, id, input);
  return result.ok
    ? json({ invoice: result.invoice, source: result.source }, { status: 201 })
    : jsonError(result.status, result.code, result.message);
}
