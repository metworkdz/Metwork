/**
 * GET    /api/metworkcrm/payments/:id
 * PATCH  /api/metworkcrm/payments/:id — status transition auto-stamps reminder/paid timestamps
 * DELETE /api/metworkcrm/payments/:id — guarded (see delete-guard.ts)
 *
 * ADMIN-only throughout — see the note in route.ts.
 */
import type { NextRequest } from 'next/server';
import { json, fromZod, noContent } from '@/server/http/json';
import { requireCrmApiAdmin } from '@/server/metworkcrm/auth/guards';
import { crmErrorResponse, safeJson } from '@/server/metworkcrm/http';
import { paymentUpdateSchema } from '@/server/metworkcrm/validation/payments';
import { pickProvidedFields } from '@/server/metworkcrm/validation/patch-utils';
import { deletePayment, getPaymentDetail, updatePayment } from '@/server/metworkcrm/services/payments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const guard = await requireCrmApiAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await params;

  try {
    return json(await getPaymentDetail(id));
  } catch (err) {
    return crmErrorResponse(err);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const guard = await requireCrmApiAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const body = await safeJson(req);
  const parsed = paymentUpdateSchema.safeParse(body);
  if (!parsed.success) return fromZod(parsed.error);

  try {
    return json(await updatePayment(id, pickProvidedFields(body, parsed.data)));
  } catch (err) {
    return crmErrorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const guard = await requireCrmApiAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await params;

  try {
    await deletePayment(id);
    return noContent();
  } catch (err) {
    return crmErrorResponse(err);
  }
}
