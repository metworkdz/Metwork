/**
 * GET    /api/metworkcrm/experts/:id — detail + org/contact + tasks/interactions
 * PATCH  /api/metworkcrm/experts/:id — partial update (stage change bumps stageChangedAt)
 * DELETE /api/metworkcrm/experts/:id — hard delete, guarded (see delete-guard.ts)
 */
import type { NextRequest } from 'next/server';
import { json, fromZod, noContent } from '@/server/http/json';
import { requireCrmApiUser } from '@/server/metworkcrm/auth/guards';
import { crmErrorResponse, safeJson } from '@/server/metworkcrm/http';
import { expertUpdateSchema } from '@/server/metworkcrm/validation/experts';
import { pickProvidedFields } from '@/server/metworkcrm/validation/patch-utils';
import { deleteExpert, getExpertDetail, updateExpert } from '@/server/metworkcrm/services/experts';

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
    return json(await getExpertDetail(id, guard.user));
  } catch (err) {
    return crmErrorResponse(err);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const guard = await requireCrmApiUser();
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const body = await safeJson(req);
  const parsed = expertUpdateSchema.safeParse(body);
  if (!parsed.success) return fromZod(parsed.error);

  try {
    return json(await updateExpert(id, pickProvidedFields(body, parsed.data)));
  } catch (err) {
    return crmErrorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const guard = await requireCrmApiUser();
  if (!guard.ok) return guard.response;
  const { id } = await params;

  try {
    await deleteExpert(id);
    return noContent();
  } catch (err) {
    return crmErrorResponse(err);
  }
}
