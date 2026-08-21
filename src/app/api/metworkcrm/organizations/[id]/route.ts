/**
 * GET    /api/metworkcrm/organizations/:id — detail + every linked Contact/Interaction/Task/Opportunity
 * PATCH  /api/metworkcrm/organizations/:id — partial update
 * DELETE /api/metworkcrm/organizations/:id — hard delete, guarded (see delete-guard.ts)
 */
import type { NextRequest } from 'next/server';
import { json, fromZod, noContent } from '@/server/http/json';
import { requireCrmApiUser } from '@/server/metworkcrm/auth/guards';
import { crmErrorResponse, safeJson } from '@/server/metworkcrm/http';
import { organizationUpdateSchema } from '@/server/metworkcrm/validation/organizations';
import {
  deleteOrganization,
  getOrganizationDetail,
  updateOrganization,
} from '@/server/metworkcrm/services/organizations';

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
    return json(await getOrganizationDetail(id, guard.user));
  } catch (err) {
    return crmErrorResponse(err);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const guard = await requireCrmApiUser();
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const body = await safeJson(req);
  const parsed = organizationUpdateSchema.safeParse(body);
  if (!parsed.success) return fromZod(parsed.error);

  try {
    return json(await updateOrganization(id, parsed.data));
  } catch (err) {
    return crmErrorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const guard = await requireCrmApiUser();
  if (!guard.ok) return guard.response;
  const { id } = await params;

  try {
    await deleteOrganization(id);
    return noContent();
  } catch (err) {
    return crmErrorResponse(err);
  }
}
