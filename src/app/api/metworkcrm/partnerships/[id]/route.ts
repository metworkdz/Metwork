/**
 * GET    /api/metworkcrm/partnerships/:id — detail + organization + contacts + tasks/interactions
 * PATCH  /api/metworkcrm/partnerships/:id — partial update; `contacts` (if present) replaces the full link set
 * DELETE /api/metworkcrm/partnerships/:id — hard delete, guarded (see delete-guard.ts)
 */
import type { NextRequest } from 'next/server';
import { json, fromZod, noContent } from '@/server/http/json';
import { requireCrmApiUser } from '@/server/metworkcrm/auth/guards';
import { crmErrorResponse, safeJson } from '@/server/metworkcrm/http';
import { partnershipUpdateSchema } from '@/server/metworkcrm/validation/partnerships';
import { pickProvidedFields } from '@/server/metworkcrm/validation/patch-utils';
import { deletePartnership, getPartnershipDetail, updatePartnership } from '@/server/metworkcrm/services/partnerships';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const guard = await requireCrmApiUser();
  if (!guard.ok) return guard.response;
  const { id } = await params;

  try {
    return json(await getPartnershipDetail(id, guard.user));
  } catch (err) {
    return crmErrorResponse(err);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const guard = await requireCrmApiUser();
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const body = await safeJson(req);
  const parsed = partnershipUpdateSchema.safeParse(body);
  if (!parsed.success) return fromZod(parsed.error);

  try {
    return json(await updatePartnership(id, pickProvidedFields(body, parsed.data)));
  } catch (err) {
    return crmErrorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const guard = await requireCrmApiUser();
  if (!guard.ok) return guard.response;
  const { id } = await params;

  try {
    await deletePartnership(id);
    return noContent();
  } catch (err) {
    return crmErrorResponse(err);
  }
}
