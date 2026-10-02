/**
 * GET   /api/consultant/invoices/settings — the invoicing letterhead
 * PATCH /api/consultant/invoices/settings — edit it
 *
 * Separate from the profile route because these fields are what makes a
 * document legally valid, and they are edited and validated as one set.
 */
import type { NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { db } from '@/server/db/store';
import { fromZod, json, jsonError } from '@/server/http/json';
import { isInstantBookEnabled } from '@/server/consultations/instant-book';
import { requireInvoicingConsultant } from '@/server/invoices/consultant-access';
import {
  consultantInvoiceSettingsSchema,
  updateConsultantInvoiceSettings,
} from '@/server/invoices/consultant-settings';
import { findIssuer, issuerLegalGate } from '@/server/invoices/owner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The letterhead plus whether it is complete enough to issue with. */
async function present(ownerId: string) {
  const data = await db.read();
  const issuer = findIssuer(data, { type: 'CONSULTANT', id: ownerId });
  if (!issuer) return null;
  const gate = issuerLegalGate(issuer.profile, 'ESPECE', { type: 'CONSULTANT', id: ownerId });
  return {
    issuer: issuer.profile,
    // The form shows this as a warning before the consultant hits a 422 on
    // their first document.
    complete: gate.ok,
    // VIREMENT needs a RIB on top of the legal header.
    canInvoiceByTransfer: issuerLegalGate(issuer.profile, 'VIREMENT', {
      type: 'CONSULTANT',
      id: ownerId,
    }).ok,
  };
}

export async function GET() {
  if (!isInstantBookEnabled()) return jsonError(404, 'NOT_FOUND', 'Not found');
  const guard = await requireInvoicingConsultant();
  if (!guard.ok) return guard.response;

  const body = await present(guard.owner.id);
  if (!body) return jsonError(404, 'NOT_FOUND', 'Consultant introuvable');
  return json(body);
}

export async function PATCH(req: NextRequest) {
  if (!isInstantBookEnabled()) return jsonError(404, 'NOT_FOUND', 'Not found');
  const guard = await requireInvoicingConsultant();
  if (!guard.ok) return guard.response;

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = consultantInvoiceSettingsSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const updated = await updateConsultantInvoiceSettings(guard.owner.id, input);
  if (!updated) return jsonError(404, 'NOT_FOUND', 'Consultant introuvable');

  const next = await present(guard.owner.id);
  return json(next);
}
