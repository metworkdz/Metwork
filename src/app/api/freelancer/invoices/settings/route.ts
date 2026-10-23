/**
 * GET   /api/freelancer/invoices/settings — the invoicing letterhead
 * PATCH /api/freelancer/invoices/settings — edit it
 *
 * Same schema and patch logic as the consultant's — see
 * `applyInvoiceSettingsPatch` — stored on the freelancer profile.
 */
import type { NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { db } from '@/server/db/store';
import { fromZod, json, jsonError } from '@/server/http/json';
import { requireInvoicingFreelancer, updateFreelancerInvoiceSettings } from '@/server/invoices/freelancer-access';
import { consultantInvoiceSettingsSchema } from '@/server/invoices/consultant-settings';
import { findIssuer, issuerLegalGate } from '@/server/invoices/owner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function present(userId: string) {
  const data = await db.read();
  const owner = { type: 'FREELANCER' as const, id: userId };
  const issuer = findIssuer(data, owner);
  if (!issuer) return null;
  const settings = data.freelancerProfiles?.find((p) => p.userId === userId)?.invoiceSettings ?? {};
  return {
    issuer: issuer.profile,
    settings,
    complete: issuerLegalGate(issuer.profile, 'ESPECE', owner).ok,
    canInvoiceByTransfer: issuerLegalGate(issuer.profile, 'VIREMENT', owner).ok,
  };
}

export async function GET() {
  const guard = await requireInvoicingFreelancer();
  if (!guard.ok) return guard.response;
  const body = await present(guard.user.id);
  if (!body) return jsonError(404, 'NOT_FOUND', 'Profile not found');
  return json(body);
}

export async function PATCH(req: NextRequest) {
  const guard = await requireInvoicingFreelancer();
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
  // Logo and stamp must come from our own upload pipeline: they are fetched
  // server-side when the PDF is drawn.
  for (const url of [input.invoiceLogoUrl, input.invoiceStampUrl]) {
    if (url && !url.startsWith('https://res.cloudinary.com/') && !/^\/uploads\/[\w\-/.]+$/.test(url)) {
      return jsonError(422, 'INVALID_IMAGE', 'Upload the image through Metwork');
    }
  }
  if (!(await updateFreelancerInvoiceSettings(guard.user.id, input))) {
    return jsonError(404, 'NOT_FOUND', 'Profile not found');
  }
  return json(await present(guard.user.id));
}
