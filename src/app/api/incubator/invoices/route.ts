/**
 * GET  /api/incubator/invoices  — list this incubator's invoices (newest first)
 * POST /api/incubator/invoices  — issue an invoice
 *
 * POST builds frozen issuer + client snapshots, then in ONE db.update():
 * allocates the number (per-incubator, per-year counter) and appends the
 * record with totals + amount-in-words computed by the canonical engine.
 * Invoices are immutable after this point (see [id]/route.ts).
 */
import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole, requireApprovedApiRole } from '@/server/auth/api-guards';
import { db, type ClientRecord, type InvoiceRecord } from '@/server/db/store';
import { findIncubatorByUserEmail } from '@/server/incubator/service';
import { fromZod, json, jsonError } from '@/server/http/json';
import {
  allocateInvoiceNumber,
  amountToFrenchWords,
  computeInvoiceTotals,
} from '@/server/invoices/engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const lineSchema = z.object({
  designation: z.string().min(1).max(300),
  quantity: z.number().positive().max(1_000_000),
  unitPriceHt: z.number().min(0).max(1_000_000_000),
});

/** Ad-hoc recipient when the invoice isn't linked to a CRM client. */
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

const createSchema = z
  .object({
    clientId: z.string().min(1).optional(),
    clientDraft: clientDraftSchema.optional(),
    lines: z.array(lineSchema).min(1).max(100),
    vatRate: z.number().min(0).max(100).optional(),
    paymentMethod: z.enum(['ESPECE', 'CHEQUE', 'VIREMENT']),
    template: z.enum(['CLASSIC', 'GREEN_BAND', 'MINIMAL']).optional(),
    /** Optional number override / custom starting range, e.g. 7 → "07/2026". */
    seq: z.number().int().positive().max(999_999).optional(),
  })
  .refine((v) => v.clientId || v.clientDraft, {
    message: 'Provide clientId or clientDraft',
    path: ['clientId'],
  });

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

export async function GET() {
  const guard = await requireApiRole(['INCUBATOR']);
  if (!guard.ok) return guard.response;

  const inc = await findIncubatorByUserEmail(guard.user.email);
  if (!inc) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');

  const data = await db.read();
  const invoices = (data.invoices ?? [])
    .filter((i) => i.incubatorId === inc.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return json({ items: invoices, total: invoices.length });
}

export async function POST(req: NextRequest) {
  const guard = await requireApprovedApiRole(['INCUBATOR']);
  if (!guard.ok) return guard.response;

  const inc = await findIncubatorByUserEmail(guard.user.email);
  if (!inc) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = createSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  // Legal-header gate: an invoice without issuer name/RC/NIF is not valid.
  const issuerRc = inc.commercialRegNumber ?? inc.registrationNumber ?? null;
  if (!inc.name || !issuerRc || !inc.nif) {
    return jsonError(
      422,
      'ISSUER_LEGAL_INCOMPLETE',
      'Complétez vos informations légales dans Paramètres',
    );
  }

  // A transfer invoice must tell the client where to pay.
  if (input.paymentMethod === 'VIREMENT' && !inc.bankRib?.trim()) {
    return jsonError(
      422,
      'ISSUER_BANK_INCOMPLETE',
      'Ajoutez vos coordonnées bancaires (RIB) dans Paramètres pour facturer par virement',
    );
  }

  const vatRate = input.vatRate ?? inc.defaultVatRate ?? 19;
  const template = input.template ?? inc.invoiceTemplate ?? 'CLASSIC';
  const now = new Date().toISOString();
  const year = new Date().getUTCFullYear();

  const result = await db.update<
    | { ok: true; invoice: InvoiceRecord }
    | { ok: false; status: number; code: string; message: string }
  >((d) => {
    const incubator = d.incubators.find((i) => i.id === inc.id);
    if (!incubator) {
      return { ok: false, status: 404, code: 'INCUBATOR_NOT_FOUND', message: 'Incubator not found' };
    }

    // Resolve the recipient inside the transaction so a concurrent client
    // edit can't slip between read and snapshot.
    let clientSnapshot: InvoiceRecord['clientSnapshot'];
    let clientId: string | null = null;
    if (input.clientId) {
      const client = (d.clients ?? []).find(
        (c) => c.id === input.clientId && c.incubatorId === inc.id,
      );
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

    // A requested number must not collide with an existing invoice.
    if (
      input.seq !== undefined &&
      d.invoices.some((i) => i.incubatorId === inc.id && i.year === year && i.seq === input.seq)
    ) {
      return {
        ok: false, status: 409, code: 'NUMBER_TAKEN',
        message: `Le numéro ${String(input.seq).padStart(2, '0')}/${year} est déjà utilisé`,
      };
    }

    const { number, seq } = allocateInvoiceNumber(incubator, year, input.seq);
    incubator.updatedAt = now;

    const totals = computeInvoiceTotals(input.lines, vatRate, input.paymentMethod);

    const invoice: InvoiceRecord = {
      id: randomUUID(),
      incubatorId: inc.id,
      number,
      year,
      seq,
      issuedAt: now,
      clientId,
      clientSnapshot,
      issuerSnapshot: {
        name: incubator.name,
        address: incubator.address ?? null,
        rc: issuerRc,
        nif: incubator.nif ?? null,
        nis: incubator.nis ?? null,
        ai: incubator.ai ?? null,
        logoUrl: incubator.logoUrl ?? null,
        website: incubator.website ?? null,
        contactEmail: incubator.contactEmail ?? incubator.email ?? null,
        contactPhone: incubator.contactPhone ?? incubator.phone ?? null,
        bankName: incubator.bankName ?? null,
        bankRib: incubator.bankRib ?? null,
      },
      lines: input.lines,
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

  if (!result.ok) return jsonError(result.status, result.code, result.message);
  return json(result.invoice, { status: 201 });
}
